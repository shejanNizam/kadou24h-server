/**
 * Business-event notifications (order, delivery, money, applications).
 * Each one is stored for the in-app list, emitted over the socket and pushed
 * to the phone (see createNotification). Sending never blocks or fails the
 * action that triggered it — errors are only logged.
 */
import { Types } from "mongoose";
import { logger } from "../../utils/logger";
import { ISubOrder } from "../order/order.interface";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { AppMode } from "../user/user.interface";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { ICreateNotificationPayload, NotificationServices } from "./notification.service";
import { NotificationType } from "./notification.interface";

type Id = Types.ObjectId | string;
type SubOrderRef = Pick<ISubOrder, "_id" | "orderId" | "subOrderNumber" | "customerId" | "vendorId">;
export type CancelledBy = "customer" | "vendor" | "admin";

const gnf = (amount: number) => `${amount.toLocaleString("fr-FR")} GNF`;

const send = (payload: ICreateNotificationPayload) => {
  NotificationServices.createNotification(payload).catch((error) =>
    logger.error("Failed to create notification", {
      type: payload.type,
      userId: String(payload.userId),
      error: error instanceof Error ? error.message : error,
    }),
  );
};

/** Runs a lookup + send without ever throwing into the caller. */
const safely = (task: () => Promise<void>) => {
  task().catch((error) =>
    logger.error("Failed to prepare notification", {
      error: error instanceof Error ? error.message : error,
    }),
  );
};

const vendorUserId = async (vendorId: Id) =>
  (await VendorProfile.findById(vendorId).select("userId").lean())?.userId;

const riderUserId = async (riderId: Id) =>
  (await RiderProfile.findById(riderId).select("userId").lean())?.userId;

const orderData = (subOrder: SubOrderRef) => ({
  orderId: String(subOrder.orderId),
  subOrderId: String(subOrder._id),
  subOrderNumber: subOrder.subOrderNumber,
});

// ── Orders ──────────────────────────────────────────────────────────

/** New sub-order → its vendor. */
const orderPlaced = (subOrder: SubOrderRef & { total: number }) =>
  safely(async () => {
    const userId = await vendorUserId(subOrder.vendorId);
    if (!userId) return;
    send({
      userId,
      mode: AppMode.vendor,
      type: NotificationType.order_placed,
      title: { fr: "Nouvelle commande", en: "New order" },
      body: {
        fr: `Commande ${subOrder.subOrderNumber} reçue (${gnf(subOrder.total)}). Acceptez-la pour commencer.`,
        en: `Order ${subOrder.subOrderNumber} received (${gnf(subOrder.total)}). Accept it to get started.`,
      },
      data: orderData(subOrder),
    });
  });

/** Vendor accepted → customer. */
const orderAccepted = (subOrder: SubOrderRef) =>
  send({
    userId: subOrder.customerId,
    mode: AppMode.customer,
    type: NotificationType.order_accepted,
    title: { fr: "Commande acceptée", en: "Order accepted" },
    body: {
      fr: `La boutique a accepté votre commande ${subOrder.subOrderNumber} et la prépare.`,
      en: `The store accepted your order ${subOrder.subOrderNumber} and is preparing it.`,
    },
    data: orderData(subOrder),
  });

/** Parcel ready → customer (the vendor now assigns a delivery partner). */
const orderReadyForPickup = (subOrder: SubOrderRef) =>
  send({
    userId: subOrder.customerId,
    mode: AppMode.customer,
    type: NotificationType.ready_for_pickup,
    title: { fr: "Commande prête", en: "Order ready" },
    body: {
      fr: `Votre commande ${subOrder.subOrderNumber} est prête et attend un livreur.`,
      en: `Your order ${subOrder.subOrderNumber} is ready and waiting for a delivery partner.`,
    },
    data: orderData(subOrder),
  });

/** Cancellation → every other party (customer, vendor, riders on active legs). */
const orderCancelled = (
  subOrder: SubOrderRef,
  by: CancelledBy,
  reason: string,
  riderIds: Id[] = [],
) =>
  safely(async () => {
    const byText = {
      customer: { fr: "par le client", en: "by the customer" },
      vendor: { fr: "par la boutique", en: "by the store" },
      admin: { fr: "par Kadou24h", en: "by Kadou24h" },
    }[by];
    const notice = (userId: Id, mode: AppMode) =>
      send({
        userId,
        mode,
        type: NotificationType.order_cancelled,
        title: { fr: "Commande annulée", en: "Order cancelled" },
        body: {
          fr: `La commande ${subOrder.subOrderNumber} a été annulée ${byText.fr} : ${reason}`,
          en: `Order ${subOrder.subOrderNumber} was cancelled ${byText.en}: ${reason}`,
        },
        data: { ...orderData(subOrder), cancelledBy: by },
      });

    if (by !== "customer") notice(subOrder.customerId, AppMode.customer);
    if (by !== "vendor") {
      const userId = await vendorUserId(subOrder.vendorId);
      if (userId) notice(userId, AppMode.vendor);
    }
    for (const riderId of new Set(riderIds.map(String))) {
      const userId = await riderUserId(riderId);
      if (userId) notice(userId, AppMode.rider);
    }
  });

/** Final leg handed over → customer (+ review request) and vendor. */
const orderDelivered = (subOrder: SubOrderRef) =>
  safely(async () => {
    const data = orderData(subOrder);
    send({
      userId: subOrder.customerId,
      mode: AppMode.customer,
      type: NotificationType.order_delivered,
      title: { fr: "Commande livrée", en: "Order delivered" },
      body: {
        fr: `Votre commande ${subOrder.subOrderNumber} a été livrée. Merci !`,
        en: `Your order ${subOrder.subOrderNumber} has been delivered. Thank you!`,
      },
      data,
    });
    send({
      userId: subOrder.customerId,
      mode: AppMode.customer,
      type: NotificationType.feedback_request,
      title: { fr: "Donnez votre avis", en: "Rate your order" },
      body: {
        fr: `Comment s'est passée la commande ${subOrder.subOrderNumber} ? Notez la boutique et le livreur.`,
        en: `How was order ${subOrder.subOrderNumber}? Rate the store and the delivery partner.`,
      },
      data,
    });
    const userId = await vendorUserId(subOrder.vendorId);
    if (userId) {
      send({
        userId,
        mode: AppMode.vendor,
        type: NotificationType.order_delivered,
        title: { fr: "Commande livrée", en: "Order delivered" },
        body: {
          fr: `La commande ${subOrder.subOrderNumber} a été livrée au client.`,
          en: `Order ${subOrder.subOrderNumber} was delivered to the customer.`,
        },
        data,
      });
    }
  });

// ── Deliveries ──────────────────────────────────────────────────────

interface DeliveryRef {
  _id: unknown;
  subOrderId: Id;
  fromName?: string;
  toName?: string;
  fee: number;
  collectsCash: boolean;
}

/** Vendor assigned a leg → the rider (with the cash to collect, if any). */
const deliveryAssigned = (riderUser: Id, delivery: DeliveryRef, codAmount?: number) => {
  const cash = delivery.collectsCash && codAmount ? codAmount : 0;
  send({
    userId: riderUser,
    mode: AppMode.rider,
    type: cash ? NotificationType.collect_payment : NotificationType.new_delivery_assigned,
    title: { fr: "Nouvelle livraison", en: "New delivery" },
    body: {
      fr: `${delivery.fromName ?? "Retrait"} → ${delivery.toName ?? "Livraison"} · gain ${gnf(delivery.fee)}${cash ? ` · encaisser ${gnf(cash)}` : ""}`,
      en: `${delivery.fromName ?? "Pickup"} → ${delivery.toName ?? "Drop-off"} · earn ${gnf(delivery.fee)}${cash ? ` · collect ${gnf(cash)}` : ""}`,
    },
    data: {
      deliveryId: String(delivery._id),
      subOrderId: String(delivery.subOrderId),
      ...(cash && { amountToCollect: cash }),
    },
  });
};

/** Rider declined → vendor must pick someone else. */
const deliveryDeclined = (vendorUser: Id, delivery: DeliveryRef, reason?: string) =>
  send({
    userId: vendorUser,
    mode: AppMode.vendor,
    type: NotificationType.ready_for_pickup,
    title: { fr: "Livraison refusée", en: "Delivery declined" },
    body: {
      fr: `Le livreur a refusé la course${reason ? ` (${reason})` : ""}. Choisissez un autre livreur.`,
      en: `The delivery partner declined${reason ? ` (${reason})` : ""}. Please choose another one.`,
    },
    data: { deliveryId: String(delivery._id), subOrderId: String(delivery.subOrderId) },
  });

/** Final leg picked up → customer, with the handover PIN reminder. */
const riderOnTheWay = (customerId: Id, delivery: DeliveryRef, subOrderNumber: string) =>
  send({
    userId: customerId,
    mode: AppMode.customer,
    type: NotificationType.rider_on_the_way,
    title: { fr: "Livreur en route", en: "Rider on the way" },
    body: {
      fr: `Votre commande ${subOrderNumber} arrive. Donnez votre code PIN au livreur uniquement à la réception.`,
      en: `Your order ${subOrderNumber} is on its way. Give your PIN to the rider only when you receive it.`,
    },
    data: { deliveryId: String(delivery._id), subOrderId: String(delivery.subOrderId) },
  });

// ── Money ───────────────────────────────────────────────────────────

const earningsUpdated = (
  userId: Id,
  mode: AppMode,
  amount: number,
  reason: { fr: string; en: string },
  data: Record<string, unknown> = {},
) =>
  send({
    userId,
    mode,
    type: NotificationType.earnings_updated,
    title: { fr: "Gains mis à jour", en: "Earnings updated" },
    body: { fr: `+${gnf(amount)} · ${reason.fr}`, en: `+${gnf(amount)} · ${reason.en}` },
    data: { amount, ...data },
  });

const withdrawalProcessed = (
  withdrawal: { _id: unknown; ownerId: Id; ownerMode: string; requestNumber: string; amount: number },
  status: "completed" | "rejected",
  reason?: string,
) =>
  send({
    userId: withdrawal.ownerId,
    mode: withdrawal.ownerMode,
    type: NotificationType.withdrawal_update,
    title:
      status === "completed"
        ? { fr: "Retrait effectué", en: "Withdrawal paid" }
        : { fr: "Retrait refusé", en: "Withdrawal rejected" },
    body:
      status === "completed"
        ? {
            fr: `Votre retrait ${withdrawal.requestNumber} de ${gnf(withdrawal.amount)} a été envoyé.`,
            en: `Your withdrawal ${withdrawal.requestNumber} of ${gnf(withdrawal.amount)} has been sent.`,
          }
        : {
            fr: `Votre retrait ${withdrawal.requestNumber} a été refusé : ${reason}. Le montant est revenu sur votre solde.`,
            en: `Your withdrawal ${withdrawal.requestNumber} was rejected: ${reason}. The amount is back in your balance.`,
          },
    data: { withdrawalId: String(withdrawal._id), status },
  });

// ── Accounts & applications ─────────────────────────────────────────

/** Vendor / rider KYC reviewed → applicant. */
// status is an ApprovalStatus value (plain string: profile.common imports this module)
const profileReviewed = (userId: Id, kind: "vendor" | "rider", status: string, note?: string) => {
  const what = kind === "vendor" ? { fr: "boutique", en: "store" } : { fr: "livreur", en: "delivery partner" };
  const approved = status === "approved";
  send({
    userId,
    mode: approved ? (kind as AppMode) : AppMode.customer,
    type: approved ? NotificationType.profile_approved : NotificationType.system_alert,
    title: approved
      ? { fr: "Profil approuvé", en: "Profile approved" }
      : { fr: "Profil à revoir", en: "Profile needs attention" },
    body: approved
      ? {
          fr: `Votre profil ${what.fr} est approuvé. Vous pouvez passer en mode ${what.fr}.`,
          en: `Your ${what.en} profile is approved. You can now switch to ${what.en} mode.`,
        }
      : {
          fr: `Votre profil ${what.fr} : ${status}${note ? ` — ${note}` : ""}.`,
          en: `Your ${what.en} profile: ${status}${note ? ` — ${note}` : ""}.`,
        },
    data: { kind, status },
  });
};

/** Job application events → applicant or employer. */
const applicationUpdate = (
  userId: Id,
  mode: AppMode,
  message: { fr: string; en: string },
  data: Record<string, unknown>,
) =>
  send({
    userId,
    mode,
    type: NotificationType.application_update,
    title: { fr: "Candidature", en: "Job application" },
    body: message,
    data,
  });

export const Notify = {
  orderPlaced,
  orderAccepted,
  orderReadyForPickup,
  orderCancelled,
  orderDelivered,
  deliveryAssigned,
  deliveryDeclined,
  riderOnTheWay,
  earningsUpdated,
  withdrawalProcessed,
  profileReviewed,
  applicationUpdate,
};
