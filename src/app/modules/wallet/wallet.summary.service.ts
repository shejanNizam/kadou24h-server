/**
 * Earnings summary for the app's Earnings and Profile headers (vendor + rider):
 * balances explained, today's figures, and a chart series for a period.
 */
import { Types } from "mongoose";
import { DeliveryStatus } from "../delivery/delivery.interface";
import { Delivery } from "../delivery/delivery.model";
import { SettlementStatus, SubOrderStatus } from "../order/order.interface";
import { SubOrder } from "../order/sub_order.model";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { SettingsServices } from "../settings/settings.service";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { WalletMode } from "./wallet.interface";
import { WalletServices } from "./wallet.service";

export const SUMMARY_RANGES = ["7d", "30d", "6m", "12m"] as const;
export type SummaryRange = (typeof SUMMARY_RANGES)[number];

// Guinea is UTC+0 all year, so day/month buckets are plain UTC dates
const TIMEZONE = "Africa/Conakry";
const DAY_MS = 24 * 60 * 60 * 1000;

const ACTIVE_SUB_ORDER = [
  SubOrderStatus.accepted,
  SubOrderStatus.preparing,
  SubOrderStatus.ready_for_pickup,
  SubOrderStatus.in_delivery,
];
const ACTIVE_DELIVERY = [
  DeliveryStatus.accepted,
  DeliveryStatus.going_to_pickup,
  DeliveryStatus.picked_up,
  DeliveryStatus.in_transit,
];

interface Bucket {
  key: string;
  earnings: number;
  count: number;
}

/** Period start and the empty buckets (oldest first) for a range. */
const buildPeriod = (range: SummaryRange, now: Date) => {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const size = Number.parseInt(range, 10);
  const monthly = range.endsWith("m");

  if (monthly) {
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (size - 1), 1));
    const keys = Array.from({ length: size }, (_, i) =>
      new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1)).toISOString().slice(0, 7),
    );
    return { today, from, monthly, keys };
  }

  const from = new Date(today.getTime() - (size - 1) * DAY_MS);
  const keys = Array.from({ length: size }, (_, i) =>
    new Date(from.getTime() + i * DAY_MS).toISOString().slice(0, 10),
  );
  return { today, from, monthly, keys };
};

/**
 * Groups delivered work by day or month. `match` selects the owner's delivered
 * documents, `dateField` is when it was delivered, `amountField` what was earned.
 */
const aggregateEarnings = async (
  model: typeof SubOrder | typeof Delivery,
  match: Record<string, unknown>,
  amountField: string,
  period: ReturnType<typeof buildPeriod>,
) => {
  const since = period.from < period.today ? period.from : period.today;
  const format = period.monthly ? "%Y-%m" : "%Y-%m-%d";

  const [result] = await (model as typeof SubOrder).aggregate<{
    series: { _id: string; earnings: number; count: number }[];
    today: { earnings: number; count: number }[];
  }>([
    { $match: { ...match, deliveredAt: { $gte: since } } },
    {
      $facet: {
        series: [
          { $match: { deliveredAt: { $gte: period.from } } },
          {
            $group: {
              _id: { $dateToString: { format, date: "$deliveredAt", timezone: TIMEZONE } },
              earnings: { $sum: `$${amountField}` },
              count: { $sum: 1 },
            },
          },
        ],
        today: [
          { $match: { deliveredAt: { $gte: period.today } } },
          { $group: { _id: null, earnings: { $sum: `$${amountField}` }, count: { $sum: 1 } } },
        ],
      },
    },
  ]);

  const byKey = new Map(result?.series.map((s) => [s._id, s]) ?? []);
  const series: Bucket[] = period.keys.map((key) => ({
    key,
    earnings: byKey.get(key)?.earnings ?? 0,
    count: byKey.get(key)?.count ?? 0,
  }));

  return {
    series,
    today: {
      earnings: result?.today[0]?.earnings ?? 0,
      count: result?.today[0]?.count ?? 0,
    },
    period: {
      from: period.from,
      to: new Date(period.today.getTime() + DAY_MS - 1),
      earnings: series.reduce((sum, b) => sum + b.earnings, 0),
      count: series.reduce((sum, b) => sum + b.count, 0),
    },
  };
};

const getMySummary = async (ownerId: string, mode: WalletMode, range: SummaryRange = "7d") => {
  const wallet = await WalletServices.getMyWallet(ownerId, mode);
  const period = buildPeriod(range, new Date());

  const base = {
    availableBalance: wallet.availableBalance,
    heldBalance: wallet.heldBalance,
    totalEarned: wallet.totalEarned,
    totalCommission: wallet.totalCommission,
    totalWithdrawn: wallet.totalWithdrawn,
  };

  if (mode === WalletMode.vendor) {
    const vendor = await VendorProfile.findOne({ userId: ownerId }).select("_id");
    // Still applying (wallet exists, no store yet): an id that matches nothing
    const vendorId = vendor?._id ?? new Types.ObjectId();

    const [stats, awaiting, newOrders, activeOrders] = await Promise.all([
      aggregateEarnings(
        SubOrder,
        { vendorId, status: SubOrderStatus.delivered },
        "vendorEarning",
        period,
      ),
      SubOrder.aggregate<{ total: number }>([
        { $match: { vendorId, settlement: SettlementStatus.awaiting_cod } },
        { $group: { _id: null, total: { $sum: "$vendorEarning" } } },
      ]),
      SubOrder.countDocuments({ vendorId, status: SubOrderStatus.new }),
      SubOrder.countDocuments({ vendorId, status: { $in: ACTIVE_SUB_ORDER } }),
    ]);
    const awaitingCod = awaiting[0]?.total ?? 0;

    return {
      mode,
      range,
      timezone: TIMEZONE,
      balances: {
        ...base,
        withdrawable: wallet.availableBalance,
        // heldBalance = orders still running (escrow) + delivered COD orders whose
        // cash the rider has not handed over yet
        inEscrow: Math.max(0, wallet.heldBalance - awaitingCod),
        awaitingCod,
      },
      counts: { newOrders, activeOrders },
      ...stats,
    };
  }

  const rider = await RiderProfile.findOne({ userId: ownerId }).select("_id cashLimit");
  const riderId = rider?._id ?? new Types.ObjectId();
  const settings = await SettingsServices.getSettings();

  const [stats, newRequests, activeDeliveries] = await Promise.all([
    aggregateEarnings(
      Delivery,
      { riderId, status: DeliveryStatus.delivered },
      "fee",
      period,
    ),
    Delivery.countDocuments({ riderId, status: DeliveryStatus.assigned }),
    Delivery.countDocuments({ riderId, status: { $in: ACTIVE_DELIVERY } }),
  ]);

  return {
    mode,
    range,
    timezone: TIMEZONE,
    balances: {
      ...base,
      cashOwed: wallet.cashOwed,
      // Same default as the COD check when a rider accepts a delivery
      cashLimit: rider?.cashLimit || settings.riderCashLimitDefault || 500000,
      // Cash owed to the platform is kept back from withdrawals
      withdrawable: Math.max(0, wallet.availableBalance - (wallet.cashOwed || 0)),
    },
    counts: { newRequests, activeDeliveries },
    ...stats,
  };
};

export const WalletSummaryServices = { getMySummary };
