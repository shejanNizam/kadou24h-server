/**
 * Booking notifications: stored + pushed (NotificationServices) and a live
 * `booking:updated` socket event for both people. Never throws into the action.
 * Workers are customers too (any user can be a worker), so everything goes to customer mode.
 */
import { Types } from "mongoose";
import { emitToUser } from "../../../socket/socket";
import { logger } from "../../utils/logger";
import { NotificationType } from "../notification/notification.interface";
import { NotificationServices } from "../notification/notification.service";
import { AppMode } from "../user/user.interface";
import { IBooking, IBookingStrike, PenaltyType, StrikeRole } from "./booking.interface";

type Id = Types.ObjectId | string;
interface Text { fr: string; en: string }

const send = (userId: Id, title: Text, body: Text, data: Record<string, unknown>) =>
  NotificationServices.createNotification({
    userId,
    mode: AppMode.customer,
    type: NotificationType.booking_update,
    title,
    body,
    data,
  }).catch((error) =>
    logger.error("Failed to create booking notification", {
      userId: String(userId),
      error: error instanceof Error ? error.message : error,
    }),
  );

/** Guinea is UTC+0 all year */
const when = (date: Date, lang: "fr" | "en") =>
  date.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", {
    timeZone: "Africa/Conakry",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const day = (date: Date, lang: "fr" | "en") =>
  date.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { timeZone: "Africa/Conakry", day: "numeric", month: "long" });

type B = Pick<IBooking, "_id" | "bookingNumber" | "customerId" | "workerId" | "scheduledAt" | "status"> & {
  respondBy?: Date;
  profession?: string;
};

const data = (b: B) => ({ kind: "booking", bookingId: String(b._id), status: b.status });

/** Both people's screens refresh live */
const live = (b: B) => {
  for (const userId of [b.customerId, b.workerId]) {
    emitToUser(String(userId), "booking:updated", { bookingId: String(b._id), status: b.status });
  }
};

const requested = (b: B, customerName: string) => {
  live(b);
  void send(
    b.workerId,
    { fr: "Nouvelle demande de réservation", en: "New booking request" },
    {
      fr: `${customerName} vous demande pour le ${when(b.scheduledAt, "fr")}. Répondez avant le ${when(b.respondBy ?? b.scheduledAt, "fr")}.`,
      en: `${customerName} wants to book you on ${when(b.scheduledAt, "en")}. Answer before ${when(b.respondBy ?? b.scheduledAt, "en")}.`,
    },
    data(b),
  );
};

const accepted = (b: B, workerName: string) => {
  live(b);
  void send(
    b.customerId,
    { fr: "Réservation acceptée", en: "Booking accepted" },
    {
      fr: `${workerName} a accepté votre demande du ${when(b.scheduledAt, "fr")}. Son numéro est maintenant visible dans la réservation.`,
      en: `${workerName} accepted your request for ${when(b.scheduledAt, "en")}. Their number is now shown in the booking.`,
    },
    data(b),
  );
};

const declined = (b: B, workerName: string) => {
  live(b);
  void send(
    b.customerId,
    { fr: "Demande refusée", en: "Request declined" },
    {
      fr: `${workerName} n'est pas disponible le ${when(b.scheduledAt, "fr")}. Vous pouvez réserver un autre travailleur.`,
      en: `${workerName} is not available on ${when(b.scheduledAt, "en")}. You can book another worker.`,
    },
    data(b),
  );
};

const expired = (b: B) => {
  live(b);
  void send(
    b.customerId,
    { fr: "Demande sans réponse", en: "No answer" },
    {
      fr: `Le travailleur n'a pas répondu à votre demande ${b.bookingNumber}. Vous pouvez réserver quelqu'un d'autre.`,
      en: `The worker did not answer your request ${b.bookingNumber}. You can book someone else.`,
    },
    data(b),
  );
  void send(
    b.workerId,
    { fr: "Demande expirée", en: "Request expired" },
    {
      fr: `Vous n'avez pas répondu à la demande ${b.bookingNumber} à temps.`,
      en: `You did not answer request ${b.bookingNumber} in time.`,
    },
    data(b),
  );
};

const cancelled = (b: B, by: "customer" | "worker" | "admin", reason?: string) => {
  live(b);
  const tail = (lang: "fr" | "en") => (reason ? (lang === "fr" ? ` Motif : ${reason}` : ` Reason: ${reason}`) : "");
  const targets: Id[] = by === "customer" ? [b.workerId] : by === "worker" ? [b.customerId] : [b.customerId, b.workerId];
  const who = { customer: { fr: "Le client", en: "The customer" }, worker: { fr: "Le travailleur", en: "The worker" }, admin: { fr: "L'équipe Kadou24h", en: "The Kadou24h team" } }[by];
  for (const userId of targets) {
    void send(
      userId,
      { fr: "Réservation annulée", en: "Booking cancelled" },
      {
        fr: `${who.fr} a annulé la réservation ${b.bookingNumber} du ${when(b.scheduledAt, "fr")}.${tail("fr")}`,
        en: `${who.en} cancelled booking ${b.bookingNumber} on ${when(b.scheduledAt, "en")}.${tail("en")}`,
      },
      data(b),
    );
  }
};

const done = (b: B, workerName: string) => {
  live(b);
  void send(
    b.customerId,
    { fr: "Travail terminé ?", en: "Job finished?" },
    {
      fr: `${workerName} indique que le travail est terminé. Vérifiez-le avant de payer, puis confirmez dans la réservation.`,
      en: `${workerName} says the job is finished. Check the work before paying, then confirm in the booking.`,
    },
    data(b),
  );
};

const notDone = (b: B, note?: string) => {
  live(b);
  void send(
    b.workerId,
    { fr: "Travail pas encore terminé", en: "Job not finished yet" },
    {
      fr: `Le client indique que le travail ${b.bookingNumber} n'est pas terminé.${note ? ` « ${note} »` : ""}`,
      en: `The customer says job ${b.bookingNumber} is not finished.${note ? ` "${note}"` : ""}`,
    },
    data(b),
  );
};

const completed = (b: B, auto: boolean) => {
  live(b);
  void send(
    b.workerId,
    { fr: "Travail confirmé", en: "Job confirmed" },
    auto
      ? { fr: `La réservation ${b.bookingNumber} est terminée (confirmée automatiquement).`, en: `Booking ${b.bookingNumber} is completed (confirmed automatically).` }
      : { fr: `Le client a confirmé la fin du travail ${b.bookingNumber}. Merci !`, en: `The customer confirmed job ${b.bookingNumber} is done. Thank you!` },
    data(b),
  );
  void send(
    b.customerId,
    { fr: "Donnez votre avis", en: "Leave a review" },
    {
      fr: "Notez le travailleur et ajoutez une photo du travail : cela aide les autres clients.",
      en: "Rate the worker and add a photo of the work: it helps other customers.",
    },
    data(b),
  );
};

const reviewed = (b: B, rating: number) => {
  live(b);
  void send(
    b.workerId,
    { fr: "Nouvel avis", en: "New review" },
    { fr: `Un client vous a donné ${rating}/5 pour la réservation ${b.bookingNumber}.`, en: `A customer rated you ${rating}/5 for booking ${b.bookingNumber}.` },
    data(b),
  );
};

/**
 * Penalty notice with the client's wording (2026-10-22): the penalty and how long it lasts.
 */
const penalty = (strike: Pick<IBookingStrike, "userId" | "role" | "tier" | "penalty" | "lessVisibleUntil" | "suspendedUntil" | "limitedUntil">) => {
  const d = { kind: "booking_penalty", role: strike.role, tier: strike.tier, penalty: strike.penalty };
  if (strike.role === StrikeRole.customer) {
    const limited = strike.penalty === PenaltyType.limited && strike.limitedUntil;
    void send(
      strike.userId,
      { fr: "Réservation annulée", en: "Booking cancelled" },
      limited
        ? {
            fr: `Après plusieurs annulations ce mois-ci, vous ne pouvez avoir qu'une réservation à la fois jusqu'au ${day(limited, "fr")}.`,
            en: `After several cancellations this month, you can only have one booking at a time until ${day(limited, "en")}.`,
          }
        : {
            fr: "Vous avez annulé une réservation acceptée. Merci de respecter vos engagements envers les travailleurs : après 3 annulations en 30 jours, vos réservations seront limitées.",
            en: "You cancelled an accepted booking. Please respect your commitments to workers: after 3 cancellations in 30 days, your bookings will be limited.",
          },
      d,
    );
    return;
  }
  if (strike.penalty === PenaltyType.warning) {
    void send(
      strike.userId,
      { fr: "Avertissement", en: "Warning" },
      {
        fr: "Vous avez annulé une réservation acceptée. Merci de respecter vos engagements envers les clients ; une récidive réduira votre visibilité.",
        en: "You have canceled an accepted reservation. Please respect your commitments to the clients; a repeat offense will reduce your visibility.",
      },
      d,
    );
  } else if (strike.penalty === PenaltyType.less_visible && strike.lessVisibleUntil) {
    const days = Math.round((strike.lessVisibleUntil.getTime() - Date.now()) / 86_400_000);
    void send(
      strike.userId,
      { fr: "Visibilité réduite", en: "Reduced visibility" },
      {
        fr: `En raison d'une deuxième annulation ce mois-ci, votre profil est temporairement moins visible pendant ${days} jours (jusqu'au ${day(strike.lessVisibleUntil, "fr")}). Une troisième annulation entraînera une suspension ou une restriction de vos réservations.`,
        en: `Due to a second cancellation this month, your profile is temporarily less visible for ${days} days (until ${day(strike.lessVisibleUntil, "en")}). A third cancellation will result in a suspension or restriction of your bookings.`,
      },
      d,
    );
  } else if (strike.suspendedUntil) {
    const limit = strike.limitedUntil;
    void send(
      strike.userId,
      { fr: "Profil suspendu 7 jours", en: "Profile suspended for 7 days" },
      {
        fr: `Troisième annulation en 30 jours : votre profil est suspendu jusqu'au ${day(strike.suspendedUntil, "fr")} (les clients ne vous voient plus et ne peuvent pas vous réserver). Ensuite, vous ne pourrez avoir qu'une réservation à la fois${limit ? ` jusqu'au ${day(limit, "fr")}` : ""}.`,
        en: `Third cancellation in 30 days: your profile is suspended until ${day(strike.suspendedUntil, "en")} (customers can't see or book you). After that, you can only have one booking at a time${limit ? ` until ${day(limit, "en")}` : ""}.`,
      },
      d,
    );
  }
};

/** The admin lifted or softened a penalty */
const penaltyChanged = (userId: Id, action: "lift" | "soften", lessVisibleUntil?: Date) =>
  void send(
    userId,
    { fr: "Sanction modifiée", en: "Penalty updated" },
    action === "lift"
      ? { fr: "L'équipe Kadou24h a levé votre sanction.", en: "The Kadou24h team lifted your penalty." }
      : {
          fr: `L'équipe Kadou24h a remplacé votre suspension : votre profil est visible mais moins mis en avant${lessVisibleUntil ? ` jusqu'au ${day(lessVisibleUntil, "fr")}` : ""}.`,
          en: `The Kadou24h team replaced your suspension: your profile is visible but less prominent${lessVisibleUntil ? ` until ${day(lessVisibleUntil, "en")}` : ""}.`,
        },
    { kind: "booking_penalty" },
  );

/** Visibility (trial or subscription) ends soon / ended */
const listing = (userId: Id, until: Date, ended: boolean) =>
  void send(
    userId,
    ended ? { fr: "Profil masqué", en: "Profile hidden" } : { fr: "Votre visibilité se termine bientôt", en: "Your visibility ends soon" },
    ended
      ? {
          fr: "Votre période de visibilité est terminée : les clients ne vous voient plus. Choisissez un abonnement pour réapparaître.",
          en: "Your visibility period has ended: customers no longer see you. Choose a subscription to appear again.",
        }
      : {
          fr: `Les clients vous voient jusqu'au ${day(until, "fr")}. Prenez un abonnement pour rester visible.`,
          en: `Customers see you until ${day(until, "en")}. Subscribe to stay visible.`,
        },
    { kind: "worker_listing" },
  );

export const BookingNotify = {
  requested,
  accepted,
  declined,
  expired,
  cancelled,
  done,
  notDone,
  completed,
  reviewed,
  penalty,
  penaltyChanged,
  listing,
};

