import type { LocalizedMessages } from "./types";

/** A delivery leg's status (DeliveryStatus), as words */
const status = {
  en: "{status, select, pending_assignment {waiting for a rider} assigned {assigned} accepted {accepted} declined {declined} going_to_pickup {on the way to pickup} picked_up {picked up} in_transit {in transit} delivered {delivered} cancelled {cancelled} other {{status}}}",
  fr: "{status, select, pending_assignment {en attente d'un livreur} assigned {attribuée} accepted {acceptée} declined {refusée} going_to_pickup {en route vers l'enlèvement} picked_up {récupérée} in_transit {en route} delivered {livrée} cancelled {annulée} other {{status}}}",
};

/** Deliveries: the store assigns a rider, open offers, PIN handovers and tracking. */
export const deliveryErrors = {
  DELIVERY_NOT_FOUND: {
    en: "Delivery not found.",
    fr: "Livraison introuvable.",
  },
  DELIVERY_NOT_YOURS: {
    en: "This delivery is no longer assigned to you.",
    fr: "Cette livraison ne vous est plus attribuée.",
  },
  DELIVERY_ALREADY_UPDATED: {
    en: "This delivery was already updated. Please refresh.",
    fr: "Cette livraison a déjà été mise à jour. Veuillez actualiser.",
  },
  TRACKING_FORBIDDEN: {
    en: "You are not authorized to view tracking for this delivery.",
    fr: "Vous n'avez pas accès au suivi de cette livraison.",
  },

  // The store assigns a rider
  ASSIGN_FORBIDDEN: {
    en: "You are not authorized to assign riders for this order.",
    fr: "Vous n'êtes pas autorisé à attribuer un livreur pour cette commande.",
  },
  ASSIGN_WRONG_STATUS: {
    en: `A rider cannot be assigned while the delivery is ${status.en}.`,
    fr: `Impossible d'attribuer un livreur : la livraison est ${status.fr}.`,
  },
  PARTNER_NOT_FOUND: {
    en: "Approved delivery partner not found.",
    fr: "Livreur approuvé introuvable.",
  },
  ASSIGN_SELF: {
    en: "You cannot assign yourself as the delivery partner.",
    fr: "Vous ne pouvez pas vous attribuer vous-même la livraison.",
  },
  PARTNER_OFFLINE: {
    en: "This rider is currently offline.",
    fr: "Ce livreur est actuellement hors ligne.",
  },
  DELIVERY_JUST_TAKEN: {
    en: "A rider has just taken this delivery. Please refresh.",
    fr: "Un livreur vient de prendre cette livraison. Veuillez actualiser.",
  },

  // Open offers: the first rider to accept takes it
  GO_ONLINE_FOR_DELIVERIES: {
    en: "Go online to take deliveries.",
    fr: "Passez en ligne pour accepter des livraisons.",
  },
  DELIVERY_ALREADY_TAKEN: {
    en: "Another rider has already taken this delivery.",
    fr: "Un autre livreur a déjà pris cette livraison.",
  },
  OFFER_NOT_OPEN: {
    en: "This delivery is not offered to riders yet.",
    fr: "Cette livraison n'est pas encore proposée aux livreurs.",
  },
  OFFER_NOT_FOR_YOU: {
    en: "This delivery is not offered to you.",
    fr: "Cette livraison ne vous est pas proposée.",
  },
  FINISH_CURRENT_RIDE: {
    en: "Finish your current ride first.",
    fr: "Terminez d'abord votre course en cours.",
  },
  TOO_MANY_ACTIVE_DELIVERIES: {
    en: "{max, plural, one {Finish your current delivery first (# at a time).} other {Finish your current deliveries first (at most # at a time).}}",
    fr: "{max, plural, one {Terminez d'abord votre livraison en cours (# à la fois).} other {Terminez d'abord vos livraisons en cours (# à la fois au maximum).}}",
  },
  RIDER_CASH_LIMIT: {
    en: "Cash on delivery amount ({total, number} GNF) exceeds authorized partner limit ({limit, number} GNF). Hand over the cash you hold first.",
    fr: "Avec cette commande, vous auriez {total, number} GNF en espèces, au-delà de votre limite de {limit, number} GNF. Reversez d'abord le cash encaissé.",
  },

  // Pickup and handover with a PIN
  PIN_LOCKED: {
    en: "Too many wrong codes. Try again in {minutes} min.",
    fr: "Trop de codes erronés. Réessayez dans {minutes} min.",
  },
  PICKUP_WRONG_STATUS: {
    en: `Cannot verify pickup while the delivery is ${status.en}.`,
    fr: `Impossible de valider l'enlèvement : la livraison est ${status.fr}.`,
  },
  HANDOVER_WRONG_STATUS: {
    en: `Cannot verify handover while the delivery is ${status.en}.`,
    fr: `Impossible de valider la remise : la livraison est ${status.fr}.`,
  },
  PREVIOUS_DRIVER_NOT_ARRIVED: {
    en: "The previous driver doesn't have the parcel yet. Wait until they reach the station.",
    fr: "Le chauffeur précédent n'a pas encore le colis. Attendez qu'il arrive à la gare.",
  },
  PICKUP_PIN_INVALID: {
    en: "Invalid pickup PIN. {remaining, plural, one {# attempt} other {# attempts}} remaining.",
    fr: "Code d'enlèvement incorrect. {remaining, plural, one {# essai restant} other {# essais restants}}.",
  },
  HANDOVER_PIN_INVALID: {
    en: "Invalid handover PIN. {remaining, plural, one {# attempt} other {# attempts}} remaining.",
    fr: "Code de remise incorrect. {remaining, plural, one {# essai restant} other {# essais restants}}.",
  },
} satisfies LocalizedMessages;
