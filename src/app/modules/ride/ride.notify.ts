/**
 * Moto-taxi notifications: stored + pushed (NotificationServices) and a live
 * `ride:updated` socket event. Never throws into the action.
 */
import { Types } from "mongoose";
import { emitToUser } from "../../../socket/socket";
import { logger } from "../../utils/logger";
import { NotificationType } from "../notification/notification.interface";
import { NotificationServices } from "../notification/notification.service";
import { AppMode } from "../user/user.interface";
import { IRide, RideStatus } from "./ride.interface";

type Id = Types.ObjectId | string;
interface Text { fr: string; en: string }
type R = Pick<IRide, "_id" | "rideNumber" | "fare" | "status"> & { pickup: { address: string }; dropoff: { address: string } };

const gnf = (amount: number) => `${amount.toLocaleString("fr-FR")} GNF`;
const km = (value: number) => `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;

const send = (userId: Id, mode: AppMode, title: Text, body: Text, data: Record<string, unknown>) =>
  NotificationServices.createNotification({ userId, mode, type: NotificationType.ride_update, title, body, data }).catch((error) =>
    logger.error("Failed to create ride notification", {
      userId: String(userId),
      error: error instanceof Error ? error.message : error,
    }),
  );

const data = (ride: R, extra: Record<string, unknown> = {}) => ({ kind: "ride", rideId: String(ride._id), status: ride.status, ...extra });

/** Both screens refresh at once (passenger and rider) */
const changed = (ride: Pick<R, "_id" | "status">, userIds: (Id | undefined)[]) => {
  for (const id of userIds) if (id) emitToUser(String(id), "ride:updated", { rideId: ride._id, status: ride.status });
};

/** A ride request near a rider: the suggested fare and how far the pickup is; they answer with a price */
const offer = (riderUser: Id, ride: R, pickupKm?: number) => {
  const away = pickupKm !== undefined ? { fr: ` · à ${km(pickupKm)}`, en: ` · ${km(pickupKm)} away` } : { fr: "", en: "" };
  send(
    riderUser,
    AppMode.rider,
    { fr: "Course moto près de vous", en: "Moto ride near you" },
    {
      fr: `${ride.pickup.address} → ${ride.dropoff.address}${away.fr} · ${gnf(ride.fare)} en espèces. Acceptez ce prix ou proposez le vôtre.`,
      en: `${ride.pickup.address} → ${ride.dropoff.address}${away.en} · ${gnf(ride.fare)} in cash. Accept this price or propose yours.`,
    },
    data(ride, { offer: true }),
  );
  emitToUser(String(riderUser), "ride:offer", { rideId: ride._id, fare: ride.fare, pickupKm });
};

const accepted = (passenger: Id, ride: R, riderName: string) =>
  send(
    passenger,
    AppMode.customer,
    { fr: "Votre moto arrive", en: "Your moto is coming" },
    { fr: `${riderName} a accepté votre course et vient vous chercher.`, en: `${riderName} accepted your ride and is on the way.` },
    data(ride),
  );

const arrived = (passenger: Id, ride: R, riderName: string) =>
  send(
    passenger,
    AppMode.customer,
    { fr: "Votre moto est arrivée", en: "Your moto is here" },
    { fr: `${riderName} vous attend au point de départ.`, en: `${riderName} is waiting at the pickup point.` },
    data(ride),
  );

const completed = (passenger: Id, ride: R) =>
  send(
    passenger,
    AppMode.customer,
    { fr: "Course terminée", en: "Ride finished" },
    {
      fr: `Payez ${gnf(ride.fare)} en espèces au chauffeur. Notez votre course !`,
      en: `Pay ${gnf(ride.fare)} in cash to the rider. Rate your ride!`,
    },
    data(ride),
  );

/** The rider dropped the ride before pickup: we look for another one */
const riderLeft = (passenger: Id, ride: R) =>
  send(
    passenger,
    AppMode.customer,
    { fr: "Nouveau chauffeur en recherche", en: "Looking for another rider" },
    {
      fr: "Votre chauffeur a annulé. Nous cherchons un autre chauffeur proche.",
      en: "Your rider cancelled. We are looking for another nearby rider.",
    },
    data(ride),
  );

const cancelledForRider = (riderUser: Id, ride: R, by: "passenger" | "admin") =>
  send(
    riderUser,
    AppMode.rider,
    { fr: "Course annulée", en: "Ride cancelled" },
    {
      fr: by === "passenger" ? `Le passager a annulé la course ${ride.rideNumber}.` : `Kadou24h a annulé la course ${ride.rideNumber}.`,
      en: by === "passenger" ? `The passenger cancelled ride ${ride.rideNumber}.` : `Kadou24h cancelled ride ${ride.rideNumber}.`,
    },
    data(ride),
  );

const cancelledForPassenger = (passenger: Id, ride: R) =>
  send(
    passenger,
    AppMode.customer,
    { fr: "Course annulée", en: "Ride cancelled" },
    { fr: `Kadou24h a annulé la course ${ride.rideNumber}.`, en: `Kadou24h cancelled ride ${ride.rideNumber}.` },
    data(ride),
  );

const expired = (passenger: Id, ride: R) =>
  send(
    passenger,
    AppMode.customer,
    { fr: "Aucun chauffeur disponible", en: "No rider available" },
    {
      fr: "Aucun chauffeur n'a accepté votre course. Réessayez dans quelques minutes.",
      en: "No rider accepted your ride. Please try again in a few minutes.",
    },
    data({ ...ride, status: RideStatus.expired }),
  );

// ── Negotiation (client, 2026-11-21) ─────────────────────────────────

/** A rider sent a price → the passenger (pushed for the first one only: they are watching the screen) */
const bidReceived = (passenger: Id, ride: R, riderName: string, price: number, first: boolean) => {
  changed(ride, [passenger]);
  if (!first) return;
  send(
    passenger,
    AppMode.customer,
    { fr: "Un chauffeur vous propose un prix", en: "A rider sent you a price" },
    { fr: `${riderName} propose ${gnf(price)}. Choisissez votre chauffeur.`, en: `${riderName} offers ${gnf(price)}. Choose your rider.` },
    data(ride, { bid: true }),
  );
};

/** The passenger chose this rider's price → the rider */
const bidAccepted = (riderUser: Id, ride: R) =>
  send(
    riderUser,
    AppMode.rider,
    { fr: "Le passager vous a choisi", en: "The passenger chose you" },
    {
      fr: `Course ${ride.rideNumber} à ${gnf(ride.fare)}. Allez au point de départ : ${ride.pickup.address}.`,
      en: `Ride ${ride.rideNumber} for ${gnf(ride.fare)}. Go to the pickup point: ${ride.pickup.address}.`,
    },
    data(ride),
  );

/** The passenger proposes a lower price → the rider */
const countered = (riderUser: Id, ride: R, price: number) =>
  send(
    riderUser,
    AppMode.rider,
    { fr: "Contre-proposition du passager", en: "The passenger made a counter-offer" },
    {
      fr: `Le passager propose ${gnf(price)} pour la course ${ride.rideNumber}. Répondez vite.`,
      en: `The passenger offers ${gnf(price)} for ride ${ride.rideNumber}. Answer quickly.`,
    },
    data(ride, { offer: true }),
  );

/** The rider said no to the counter-offer → the passenger */
const counterDeclined = (passenger: Id, ride: R, riderName: string) =>
  send(
    passenger,
    AppMode.customer,
    { fr: "Contre-proposition refusée", en: "Counter-offer declined" },
    { fr: `${riderName} a refusé votre prix. Choisissez une autre offre.`, en: `${riderName} declined your price. Choose another offer.` },
    data(ride),
  );

export const RideNotify = { changed, bidReceived, bidAccepted, countered, counterDeclined, offer, accepted, arrived, completed, riderLeft, cancelledForRider, cancelledForPassenger, expired };
