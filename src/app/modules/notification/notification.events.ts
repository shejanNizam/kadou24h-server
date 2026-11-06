/**
 * Business-event notifications (order, delivery, money, applications).
 * Each one is stored for the in-app list, emitted over the socket and pushed
 * to the phone (see createNotification). Sending never blocks or fails the
 * action that triggered it — errors are only logged.
 */
import { Types } from "mongoose";
import { emitToUser } from "../../../socket/socket";
import { logger } from "../../utils/logger";
import { ISubOrder } from "../order/order.interface";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { AppMode } from "../user/user.interface";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { ICreateNotificationPayload, NotificationServices } from "./notification.service";
import { NotificationType } from "./notification.interface";

type Id = Types.ObjectId | string;
type SubOrderRef = Pick<ISubOrder, "_id" | "orderId" | "subOrderNumber" | "customerId" | "vendorId">;
export type CancelledBy = "customer" | "vendor" | "admin" | "system";

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

/** Store changed the items (agreed in chat) → customer, with the new total. */
const orderModified = (subOrder: SubOrderRef, newTotal: number) =>
  send({
    userId: subOrder.customerId,
    mode: AppMode.customer,
    type: NotificationType.order_accepted,
    title: { fr: "Commande modifiée", en: "Order changed" },
    body: {
      fr: `La boutique a modifié votre commande ${subOrder.subOrderNumber}. Nouveau total : ${gnf(newTotal)}.`,
      en: `The store changed your order ${subOrder.subOrderNumber}. New total: ${gnf(newTotal)}.`,
    },
    data: orderData(subOrder),
  });

// ── Refunds ─────────────────────────────────────────────────────────

/** A refund request was opened for a paid order → customer (the team reviews it). */
const refundRequested = (refund: { customerId: Id; orderId: Id; amount: number }, orderNumber: string) =>
  send({
    userId: refund.customerId,
    mode: AppMode.customer,
    type: NotificationType.refund_update,
    title: { fr: "Remboursement en cours", en: "Refund in progress" },
    body: {
      fr: `Commande ${orderNumber} : un remboursement de ${gnf(refund.amount)} est en cours de vérification par l'équipe Kadou24h.`,
      en: `Order ${orderNumber}: a refund of ${gnf(refund.amount)} is being reviewed by the Kadou24h team.`,
    },
    data: { orderId: String(refund.orderId) },
  });

/** Admin decided → customer. */
const refundProcessed = (
  refund: { customerId: Id; orderId: Id; amount: number; rejectionReason?: string; transactionId?: string },
  orderNumber: string,
  status: "completed" | "rejected",
) =>
  send({
    userId: refund.customerId,
    mode: AppMode.customer,
    type: NotificationType.refund_update,
    title: status === "completed" ? { fr: "Remboursement envoyé", en: "Refund sent" } : { fr: "Remboursement refusé", en: "Refund declined" },
    body:
      status === "completed"
        ? {
            fr: `Commande ${orderNumber} : ${gnf(refund.amount)} vous ont été remboursés${refund.transactionId ? ` (réf. ${refund.transactionId})` : ""}.`,
            en: `Order ${orderNumber}: ${gnf(refund.amount)} has been refunded to you${refund.transactionId ? ` (ref. ${refund.transactionId})` : ""}.`,
          }
        : {
            fr: `Commande ${orderNumber} : le remboursement a été refusé. ${refund.rejectionReason ?? ""}`.trim(),
            en: `Order ${orderNumber}: the refund was declined. ${refund.rejectionReason ?? ""}`.trim(),
          },
    data: { orderId: String(refund.orderId) },
  });

/** Cancellation → every other party (customer, vendor, riders on active legs). */
const orderCancelled = (
  subOrder: SubOrderRef,
  by: CancelledBy,
  reason: string,
  riderIds: Id[] = [],
  /** false when the store never saw the order (cancelled before it was paid) */
  notifyVendor = true,
) =>
  safely(async () => {
    const byText = {
      customer: { fr: "par le client", en: "by the customer" },
      vendor: { fr: "par la boutique", en: "by the store" },
      admin: { fr: "par Kadou24h", en: "by Kadou24h" },
      system: { fr: "automatiquement", en: "automatically" },
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
    if (by !== "vendor" && notifyVendor) {
      const userId = await vendorUserId(subOrder.vendorId);
      if (userId) notice(userId, AppMode.vendor);
    }
    for (const riderId of new Set(riderIds.map(String))) {
      const userId = await riderUserId(riderId);
      if (userId) notice(userId, AppMode.rider);
    }
  });

/** Online order not paid in time → customer (one notice per order, the store never saw it). */
const orderPaymentExpired = (order: { _id: Id; orderNumber: string; customerId: Id }, minutes: number) =>
  send({
    userId: order.customerId,
    mode: AppMode.customer,
    type: NotificationType.order_cancelled,
    title: { fr: "Commande annulée", en: "Order cancelled" },
    body: {
      fr: `Le paiement de la commande ${order.orderNumber} n'a pas été reçu en ${minutes} minutes. Elle a été annulée et les articles sont de retour dans votre panier.`,
      en: `Payment for order ${order.orderNumber} was not received within ${minutes} minutes. It was cancelled and the items are back in your cart.`,
    },
    data: { orderId: String(order._id), cancelledBy: "system" },
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

/** Vendor assigned a leg → the rider (with the cash to collect, and how long they have to answer). */
const deliveryAssigned = (riderUser: Id, delivery: DeliveryRef, codAmount?: number, answerMinutes?: number) => {
  const cash = delivery.collectsCash && codAmount ? codAmount : 0;
  const within = answerMinutes ? { fr: ` · répondez sous ${answerMinutes} min`, en: ` · answer within ${answerMinutes} min` } : { fr: "", en: "" };
  send({
    userId: riderUser,
    mode: AppMode.rider,
    type: cash ? NotificationType.collect_payment : NotificationType.new_delivery_assigned,
    title: { fr: "Nouvelle livraison", en: "New delivery" },
    body: {
      fr: `${delivery.fromName ?? "Retrait"} → ${delivery.toName ?? "Livraison"} · gain ${gnf(delivery.fee)}${cash ? ` · encaisser ${gnf(cash)}` : ""}${within.fr}`,
      en: `${delivery.fromName ?? "Pickup"} → ${delivery.toName ?? "Drop-off"} · earn ${gnf(delivery.fee)}${cash ? ` · collect ${gnf(cash)}` : ""}${within.en}`,
    },
    data: {
      deliveryId: String(delivery._id),
      subOrderId: String(delivery.subOrderId),
      ...(cash && { amountToCollect: cash }),
    },
  });
};

const km = (value: number) => `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;

/** A leg is offered near a rider (open dispatch): distance and earnings; the first to accept takes it. */
const deliveryOffer = (riderUser: Id, delivery: DeliveryRef, pickupKm?: number, codAmount?: number) => {
  const cash = delivery.collectsCash && codAmount ? codAmount : 0;
  const away = pickupKm !== undefined ? { fr: ` · à ${km(pickupKm)}`, en: ` · ${km(pickupKm)} away` } : { fr: "", en: "" };
  send({
    userId: riderUser,
    mode: AppMode.rider,
    type: NotificationType.new_delivery_assigned,
    title: { fr: "Nouvelle course près de vous", en: "New delivery near you" },
    body: {
      fr: `${delivery.fromName ?? "Retrait"} → ${delivery.toName ?? "Livraison"}${away.fr} · gain ${gnf(delivery.fee)}${cash ? ` · encaisser ${gnf(cash)}` : ""}. Le premier qui accepte la prend.`,
      en: `${delivery.fromName ?? "Pickup"} → ${delivery.toName ?? "Drop-off"}${away.en} · earn ${gnf(delivery.fee)}${cash ? ` · collect ${gnf(cash)}` : ""}. The first to accept gets it.`,
    },
    data: { deliveryId: String(delivery._id), subOrderId: String(delivery.subOrderId), offer: true },
  });
};

/** A rider took a leg that leaves the store → the store. */
const deliveryTaken = (vendorUser: Id, delivery: DeliveryRef, riderName: string, subOrderNumber: string) =>
  send({
    userId: vendorUser,
    mode: AppMode.vendor,
    type: NotificationType.ready_for_pickup,
    title: { fr: "Livreur trouvé", en: "Rider found" },
    body: {
      fr: `${riderName} vient chercher la commande ${subOrderNumber}.`,
      en: `${riderName} is coming to collect order ${subOrderNumber}.`,
    },
    data: { deliveryId: String(delivery._id), subOrderId: String(delivery.subOrderId) },
  });

/** The rider chosen by the store did not answer in time → the store (the leg is open to everyone again). */
const reservationExpired = (vendorUser: Id, delivery: DeliveryRef, riderName: string) =>
  send({
    userId: vendorUser,
    mode: AppMode.vendor,
    type: NotificationType.ready_for_pickup,
    title: { fr: "Pas de réponse du livreur", en: "No answer from the rider" },
    body: {
      fr: `${riderName} n'a pas répondu à temps. La livraison est proposée aux livreurs proches.`,
      en: `${riderName} didn't answer in time. The delivery is now offered to nearby riders.`,
    },
    data: { deliveryId: String(delivery._id), subOrderId: String(delivery.subOrderId) },
  });

/** Nobody took an open leg for a while → the store (legs leaving it) and the Kadou24h team. */
const noRiderYet = (
  delivery: DeliveryRef & { orderId: Id },
  subOrderNumber: string,
  minutes: number,
  vendorUser: Id | undefined,
  staffIds: Id[],
) => {
  if (vendorUser) {
    send({
      userId: vendorUser,
      mode: AppMode.vendor,
      type: NotificationType.ready_for_pickup,
      title: { fr: "Toujours aucun livreur", en: "Still no rider" },
      body: {
        fr: `Personne n'a encore pris la commande ${subOrderNumber} (${minutes} min). Vous pouvez choisir un livreur, ou attendre : l'équipe Kadou24h est prévenue.`,
        en: `Nobody has taken order ${subOrderNumber} yet (${minutes} min). You can choose a rider, or wait: the Kadou24h team has been told.`,
      },
      data: { deliveryId: String(delivery._id), subOrderId: String(delivery.subOrderId) },
    });
  }
  for (const userId of staffIds) {
    send({
      userId,
      type: NotificationType.system_alert,
      title: { fr: "Livraison sans livreur", en: "Delivery without a rider" },
      body: {
        fr: `${subOrderNumber} : ${delivery.fromName ?? ""} → ${delivery.toName ?? ""}, aucun livreur depuis ${minutes} min.`,
        en: `${subOrderNumber}: ${delivery.fromName ?? ""} → ${delivery.toName ?? ""}, no rider for ${minutes} min.`,
      },
      data: { deliveryId: String(delivery._id), subOrderId: String(delivery.subOrderId), orderId: String(delivery.orderId) },
    });
  }
};

/** Rider declined → vendor (the leg is offered to nearby riders again). */
const deliveryDeclined = (vendorUser: Id, delivery: DeliveryRef, reason?: string) =>
  send({
    userId: vendorUser,
    mode: AppMode.vendor,
    type: NotificationType.ready_for_pickup,
    title: { fr: "Livraison refusée", en: "Delivery declined" },
    body: {
      fr: `Le livreur a refusé la course${reason ? ` (${reason})` : ""}. Elle est proposée aux livreurs proches ; vous pouvez aussi en choisir un.`,
      en: `The delivery partner declined${reason ? ` (${reason})` : ""}. It is offered to nearby riders; you can also choose one.`,
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

/** Admin checked the COD cash a rider declared → the rider. */
const codSettlementProcessed = (
  riderUser: Id,
  settlement: { _id: unknown; amount: number },
  status: "confirmed" | "rejected",
  reason?: string,
) =>
  send({
    userId: riderUser,
    mode: AppMode.rider,
    type: NotificationType.earnings_updated,
    title:
      status === "confirmed"
        ? { fr: "Versement confirmé", en: "Cash hand-over confirmed" }
        : { fr: "Versement refusé", en: "Cash hand-over rejected" },
    body:
      status === "confirmed"
        ? {
            fr: `Kadou24h a bien reçu ${gnf(settlement.amount)}. Votre dette de cash a baissé.`,
            en: `Kadou24h received ${gnf(settlement.amount)}. Your cash to hand over went down.`,
          }
        : {
            fr: `Votre versement de ${gnf(settlement.amount)} a été refusé : ${reason ?? "—"}. Le montant reste à reverser.`,
            en: `Your hand-over of ${gnf(settlement.amount)} was rejected: ${reason ?? "—"}. The amount is still owed.`,
          },
    data: { settlementId: String(settlement._id), status },
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
/**
 * Vendor / rider KYC reviewed → applicant: live socket event + stored/pushed notification.
 * status is an ApprovalStatus value (plain string, so this module never imports profile.common).
 */
const profileReviewed = (userId: Id, kind: "vendor" | "rider", status: string, note?: string) => {
  emitToUser(String(userId), "application:reviewed", { kind, status, note });
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

/** Worker profile reviewed by an admin → the worker (customer mode; any user can be a worker). */
const workerReviewed = (userId: Id, status: string, note?: string) => {
  emitToUser(String(userId), "application:reviewed", { kind: "worker", status, note });
  const approved = status === "approved";
  const text = {
    approved: { fr: "Votre profil de travailleur est approuvé : les clients peuvent vous trouver et vous écrire.", en: "Your worker profile is approved: customers can now find you and message you." },
    rejected: { fr: "Votre profil de travailleur a été refusé", en: "Your worker profile was rejected" },
    needs_changes: { fr: "Votre profil de travailleur doit être complété", en: "Your worker profile needs changes" },
    suspended: { fr: "Votre profil de travailleur est suspendu", en: "Your worker profile is suspended" },
  }[status as "approved" | "rejected" | "needs_changes" | "suspended"] ?? { fr: `Profil de travailleur : ${status}`, en: `Worker profile: ${status}` };
  send({
    userId,
    mode: AppMode.customer,
    type: approved ? NotificationType.profile_approved : NotificationType.system_alert,
    title: approved ? { fr: "Profil approuvé", en: "Profile approved" } : { fr: "Profil de travailleur", en: "Worker profile" },
    body: approved
      ? text
      : { fr: `${text.fr}${note ? ` : ${note}` : "."}`, en: `${text.en}${note ? `: ${note}` : "."}` },
    data: { kind: "worker", status },
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

/** The Kadou24h team removed a job offer (with its reason) or put it back: to its poster */
const jobModerated = (
  userId: Id,
  mode: AppMode,
  job: { _id: unknown; title: string },
  change: { removed: true; reason: string } | { removed: false },
) =>
  send({
    userId,
    mode,
    type: NotificationType.job_update,
    title: change.removed ? { fr: "Offre retirée", en: "Job offer removed" } : { fr: "Offre rétablie", en: "Job offer restored" },
    body: change.removed
      ? {
          fr: `L'équipe Kadou24h a retiré votre offre « ${job.title} ». Motif : ${change.reason}`,
          en: `The Kadou24h team removed your job offer "${job.title}". Reason: ${change.reason}`,
        }
      : {
          fr: `L'équipe Kadou24h a rétabli votre offre « ${job.title} ».`,
          en: `The Kadou24h team restored your job offer "${job.title}".`,
        },
    data: { jobId: String(job._id) },
  });

export const Notify = {
  orderPlaced,
  orderAccepted,
  orderReadyForPickup,
  orderModified,
  refundRequested,
  refundProcessed,
  orderCancelled,
  workerReviewed,
  orderPaymentExpired,
  orderDelivered,
  deliveryAssigned,
  deliveryOffer,
  deliveryTaken,
  reservationExpired,
  noRiderYet,
  deliveryDeclined,
  riderOnTheWay,
  earningsUpdated,
  withdrawalProcessed,
  codSettlementProcessed,
  profileReviewed,
  applicationUpdate,
  jobModerated,
};
