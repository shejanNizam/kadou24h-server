/**
 * A store must accept a new order in time (client, 2026-11-21: "an unaccepted order should be
 * cancelled automatically after a delay you recommend, and the customer notified").
 *
 * - The delay is settings.orders.acceptMinutes (default 8 hours, client 2026-11-24), counted from `awaitingSince`
 *   (when the store got the order: placed, or paid for online orders).
 * - Half-way, the store gets one reminder.
 * - Past the delay the sub-order is cancelled by the system through the usual cancel path:
 *   stock back, escrow reversed, any money paid goes into a refund request, the customer and
 *   the store are told (code "not_accepted").
 * Runs every minute (server start).
 */
import { Types } from "mongoose";
import { logger } from "../../utils/logger";
import { Notify } from "../notification/notification.events";
import { SettingsServices } from "../settings/settings.service";
import { SubOrderStatus } from "./order.interface";
import { cancelSubOrder } from "./order.utils";
import { SubOrder } from "./sub_order.model";

const MINUTE = 60_000;
const BATCH = 200;
const DEFAULT_ACCEPT_MINUTES = 8 * 60;

/** Orders made before `awaitingSince` existed count from their creation */
const waitingSince = (cutoff: Date) => ({
  $or: [{ awaitingSince: { $lte: cutoff } }, { awaitingSince: { $exists: false }, createdAt: { $lte: cutoff } }],
});

const acceptMinutes = async () => (await SettingsServices.getSettings()).orders?.acceptMinutes ?? DEFAULT_ACCEPT_MINUTES;

/** Cancels the new orders the store let wait too long, then reminds the stores half-way. */
const expireNotAcceptedOrders = async (now = new Date()) => {
  const minutes = await acceptMinutes();
  const late = await SubOrder.find({
    status: SubOrderStatus.new,
    ...waitingSince(new Date(now.getTime() - minutes * MINUTE)),
  })
    .select("_id customerId")
    .limit(BATCH)
    .lean();

  let cancelled = 0;
  for (const so of late) {
    try {
      await cancelSubOrder({
        filter: { _id: so._id },
        allowedFrom: [SubOrderStatus.new],
        by: "system",
        code: "not_accepted",
        reason: `Not accepted by the store within ${minutes} minutes`,
        actorUserId: String(so.customerId),
      });
      cancelled++;
    } catch {
      // Accepted (or cancelled) at the same moment: nothing to do
    }
  }

  const reminded = await remindStores(minutes, now);
  return { cancelled, reminded };
};

/** One reminder per order, once half the delay is gone */
const remindStores = async (minutes: number, now: Date) => {
  const due = await SubOrder.find({
    status: SubOrderStatus.new,
    acceptReminderAt: { $exists: false },
    ...waitingSince(new Date(now.getTime() - (minutes * MINUTE) / 2)),
  })
    .select("_id orderId subOrderNumber customerId vendorId awaitingSince createdAt")
    .limit(BATCH)
    .lean();

  let sent = 0;
  for (const so of due) {
    // Atomic claim: never two reminders for the same order
    const claimed = await SubOrder.updateOne(
      { _id: so._id, status: SubOrderStatus.new, acceptReminderAt: { $exists: false } },
      { $set: { acceptReminderAt: now } },
    );
    if (!claimed.modifiedCount) continue;
    const since = (so.awaitingSince ?? (so as unknown as { createdAt: Date }).createdAt).getTime();
    const minutesLeft = Math.max(1, Math.ceil((since + minutes * MINUTE - now.getTime()) / MINUTE));
    Notify.orderAcceptReminder({ ...so, _id: so._id as Types.ObjectId }, minutesLeft);
    sent++;
  }
  return sent;
};

const SWEEP_EVERY_MS = Number(process.env.ORDER_ACCEPT_SWEEP_MS) || 60_000;

/** Starts the minute-by-minute sweep (server start). */
const startAcceptSweep = () => {
  const run = () =>
    expireNotAcceptedOrders().catch((error) =>
      logger.error("Not-accepted order sweep failed", { error: error instanceof Error ? error.message : error }),
    );
  void run();
  const timer = setInterval(run, SWEEP_EVERY_MS);
  timer.unref();
  return timer;
};

export const OrderAcceptServices = {
  expireNotAcceptedOrders,
  startAcceptSweep,
};
