import type { LocalizedMessages } from "./types";

/** Stores and riders (applications, documents, the store's rider network), addresses, delivery rates and stations. */
export const partnerErrors = {
  // Applications (store, rider)
  VENDOR_APPLICATION_NOT_STARTED: {
    en: "You have not started a vendor application.",
    fr: "Vous n'avez pas encore commencé de demande vendeur.",
  },
  RIDER_APPLICATION_NOT_DRAFT: {
    en: "This application was already sent: it can no longer be deleted.",
    fr: "Cette demande a déjà été envoyée : elle ne peut plus être supprimée.",
  },
  RIDER_APPLICATION_NOT_STARTED: {
    en: "You have not started a delivery partner application.",
    fr: "Vous n'avez pas encore commencé de demande livreur.",
  },
  APPLICATION_INCOMPLETE: {
    en: "Please complete: {fields}.",
    fr: "Veuillez compléter : {fields}.",
  },
  STORE_NOT_APPROVED_YET: {
    en: "Your store is not approved.",
    fr: "Votre boutique n'est pas approuvée.",
  },
  RIDER_NOT_APPROVED: {
    en: "Your delivery partner account is not approved.",
    fr: "Votre compte livreur n'est pas approuvé.",
  },
  DOCUMENT_NOT_FOUND: {
    en: "Document not found.",
    fr: "Document introuvable.",
  },
  APPLICANT_ACCOUNT_GONE: {
    en: "The applicant's account no longer exists.",
    fr: "Le compte du demandeur n'existe plus.",
  },
  OPENING_HOURS_INVALID: {
    en: "The opening time must be before the closing time.",
    fr: "L'heure d'ouverture doit précéder l'heure de fermeture.",
  },

  // Riders: vehicle and routes
  VEHICLE_NOT_ALLOWED: {
    en: "{partnerType, select, moto {A local delivery partner can use a motorbike, a bicycle or a car.} transit {An intercity driver can use a bus, a minibus or a car.} other {This vehicle does not fit your partner type.}}",
    fr: "{partnerType, select, moto {Un livreur local peut utiliser une moto, un vélo ou une voiture.} transit {Un chauffeur interurbain peut utiliser un bus, un minibus ou une voiture.} other {Ce véhicule ne correspond pas à votre type de livreur.}}",
  },
  TRANSIT_ROUTES_ONLY_DRIVERS: {
    en: "Only intercity drivers have transit routes.",
    fr: "Seuls les chauffeurs interurbains ont des trajets.",
  },
  ROUTE_STATIONS_SAME: {
    en: "A route needs two different stations.",
    fr: "Un trajet doit relier deux gares différentes.",
  },

  // A store's own riders (network)
  LINK_SIDE_INVALID: {
    en: "Choose vendor or rider.",
    fr: "Choisissez vendor ou rider.",
  },
  LINK_ALREADY_CONNECTED: {
    en: "You are already connected.",
    fr: "Vous êtes déjà connectés.",
  },
  LINK_INVITE_PENDING: {
    en: "Invitation already sent — waiting for an answer.",
    fr: "Invitation déjà envoyée : en attente de réponse.",
  },
  LINK_SELF: {
    en: "You cannot link your own delivery account to your own store.",
    fr: "Vous ne pouvez pas relier votre propre compte livreur à votre propre boutique.",
  },
  LINK_ONLY_MOTO: {
    en: "Only local delivery partners can join a store network.",
    fr: "Seuls les livreurs locaux peuvent rejoindre une boutique.",
  },
  LINK_NOT_FOUND: {
    en: "Connection not found.",
    fr: "Connexion introuvable.",
  },
  LINK_NOT_PENDING: {
    en: "This invitation is no longer pending.",
    fr: "Cette invitation n'est plus en attente.",
  },
  LINK_ONLY_INVITEE: {
    en: "Only the invited party can answer.",
    fr: "Seule la personne invitée peut répondre.",
  },

  // Subscriptions
  RIDE_PLAN_ONLY_MOTO: {
    en: "Only approved moto riders can take a moto-taxi plan.",
    fr: "Seuls les livreurs moto validés peuvent prendre un abonnement moto-taxi.",
  },

  // Addresses
  ADDRESS_NEIGHBORHOOD_REQUIRED: {
    en: "Add your neighbourhood (quartier) to this address before continuing.",
    fr: "Ajoutez votre quartier à cette adresse avant de continuer.",
  },
  ADDRESS_NOT_FOUND: {
    en: "Address not found.",
    fr: "Adresse introuvable.",
  },
  ADDRESS_LIMIT: {
    en: "You can save up to {max} addresses.",
    fr: "Vous pouvez enregistrer jusqu'à {max} adresses.",
  },

  // Delivery rates and stations
  STATIONS_REQUIRED: {
    en: "Choose the departure and arrival stations for intercity delivery.",
    fr: "Choisissez les gares de départ et d'arrivée pour la livraison interurbaine.",
  },
  NO_INTERCITY_ROUTE: {
    en: "No active intercity route found for the selected stations.",
    fr: "Aucun trajet interurbain actif entre ces gares.",
  },
  LOCATIONS_REQUIRED: {
    en: "The store and customer locations are required for local delivery.",
    fr: "Les positions de la boutique et du client sont obligatoires pour la livraison locale.",
  },
  INTERCITY_FARE_TOO_LOW: {
    en: "The route fare must be more than {motos, number} GNF: the two motos (to and from the stations) are paid from it, the bus gets the rest.",
    fr: "Le tarif du trajet doit dépasser {motos, number} GNF : les deux motos (vers et depuis les gares) sont payées dessus, le car reçoit le reste.",
  },
  INTERCITY_MOTOS_ABOVE_FARE: {
    en: "The two motos ({motos, number} GNF) would take the whole fare of a route ({fare, number} GNF). Raise that route's fare first.",
    fr: "Les deux motos ({motos, number} GNF) prendraient tout le tarif d'un trajet ({fare, number} GNF). Augmentez d'abord le tarif de ce trajet.",
  },
  DELIVERY_RATE_NOT_FOUND: {
    en: "Delivery rate not found.",
    fr: "Tarif de livraison introuvable.",
  },
  STATIONS_INVALID: {
    en: "One or more bus stations are invalid or inactive.",
    fr: "Une ou plusieurs gares routières sont invalides ou inactives.",
  },
  STATION_NOT_FOUND: {
    en: "Station not found.",
    fr: "Gare introuvable.",
  },
} satisfies LocalizedMessages;
