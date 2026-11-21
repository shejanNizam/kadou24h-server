import type { LocalizedMessages } from "./types";

/** A booking's status (BookingStatus), as words */
const bookingStatus = {
  en: "{status, select, requested {waiting for an answer} accepted {accepted} declined {declined} expired {expired} cancelled {cancelled} done {marked as done} completed {completed} other {{status}}}",
  fr: "{status, select, requested {en attente de réponse} accepted {acceptée} declined {refusée} expired {expirée} cancelled {annulée} done {indiquée comme terminée} completed {terminée} other {{status}}}",
};

/** Workers and their bookings, the job board, and moto-taxi rides. */
export const serviceErrors = {
  // Worker profiles
  WORKER_NOT_FOUND: {
    en: "Worker profile not found.",
    fr: "Profil de travailleur introuvable.",
  },
  WORKER_NOT_APPROVED: {
    en: "Your worker profile is not approved.",
    fr: "Votre profil de travailleur n'est pas approuvé.",
  },
  WORKER_LIST_NOT_APPROVED: {
    en: "Your worker profile must be approved before it can be listed.",
    fr: "Votre profil de travailleur doit d'abord être approuvé.",
  },
  WORKER_PROFILE_INCOMPLETE: {
    en: "Complete your worker profile first: {fields}.",
    fr: "Complétez d'abord votre profil de travailleur : {fields}.",
  },
  WORKER_ALREADY_APPROVED: {
    en: "Your worker profile is already approved.",
    fr: "Votre profil de travailleur est déjà approuvé.",
  },
  WORK_PHOTOS_TOO_MANY: {
    en: "Up to {maximum} work photos.",
    fr: "{maximum} photos de travaux au maximum.",
  },

  // Bookings
  BOOKING_NOT_FOUND: {
    en: "Booking not found.",
    fr: "Réservation introuvable.",
  },
  BOOKING_ADDRESS_REQUIRED: {
    en: "Please choose the address where the work will be done.",
    fr: "Choisissez l'adresse du travail.",
  },
  BOOKING_DATE_REQUIRED: {
    en: "Choose the date and time.",
    fr: "Choisissez la date et l'heure.",
  },
  BOOKING_DESCRIPTION_TOO_SHORT: {
    en: "Describe the job (at least {minimum} characters).",
    fr: "Décrivez le travail (au moins {minimum} caractères).",
  },
  WORKER_UNAVAILABLE: {
    en: "This worker is not available for bookings.",
    fr: "Ce travailleur n'est pas disponible pour le moment.",
  },
  BOOK_SELF: {
    en: "You cannot book yourself.",
    fr: "Vous ne pouvez pas vous réserver vous-même.",
  },
  BOOKING_TOO_SOON: {
    en: "Choose a date and time at least {minutes} minutes from now.",
    fr: "Choisissez une heure au moins {minutes} minutes après maintenant.",
  },
  BOOKING_TOO_FAR: {
    en: "You can book up to {days} days ahead.",
    fr: "Vous pouvez réserver jusqu'à {days} jours à l'avance.",
  },
  BOOKING_LIMITED: {
    en: "Your bookings are limited to one at a time until {until, date, day}.",
    fr: "Vos réservations sont limitées à une à la fois jusqu'au {until, date, day}.",
  },
  BOOKING_DUPLICATE: {
    en: "You already have an open booking with this worker.",
    fr: "Vous avez déjà une réservation en cours avec ce travailleur.",
  },
  BOOKING_TOO_MANY_REQUESTS: {
    en: "You can have up to {max} requests waiting for an answer.",
    fr: "Vous pouvez avoir au maximum {max} demandes en attente de réponse.",
  },
  BOOKING_ACTION_NOT_ALLOWED: {
    en: `This booking is ${bookingStatus.en}: you can't {action, select, accept {accept} decline {decline} finish {finish} confirm {confirm} reopen {reopen} cancel {cancel} other {change}} it.`,
    fr: `Cette réservation est ${bookingStatus.fr} : vous ne pouvez pas {action, select, accept {l'accepter} decline {la refuser} finish {la terminer} confirm {la confirmer} reopen {la rouvrir} cancel {l'annuler} other {la modifier}}.`,
  },
  WORKER_SUSPENDED: {
    en: "Your bookings are suspended until {until, date, day}.",
    fr: "Vos réservations sont suspendues jusqu'au {until, date, day}.",
  },
  WORKER_LIMITED: {
    en: "You can only have one booking at a time until {until, date, day}.",
    fr: "Une seule réservation à la fois jusqu'au {until, date, day} : terminez d'abord la précédente.",
  },
  BOOKING_EXPIRED: {
    en: "This request has expired.",
    fr: "Cette demande a expiré.",
  },
  BOOKING_DONE_CONFIRM: {
    en: "The job is marked as done: confirm it or say it is not finished.",
    fr: "Le travail est indiqué comme terminé : confirmez-le ou dites qu'il n'est pas fini.",
  },
  CANCEL_REASON_REQUIRED: {
    en: "Please give the reason for cancelling.",
    fr: "Indiquez le motif de l'annulation.",
  },
  BOOKING_CHANGED: {
    en: "This booking has just changed. Please refresh.",
    fr: "Cette réservation vient de changer. Veuillez actualiser.",
  },
  BOOKING_NOT_OPEN: {
    en: "Only an open booking can be cancelled.",
    fr: "Seule une réservation en cours peut être annulée.",
  },
  BOOKING_REVIEW_TOO_EARLY: {
    en: "You can review a worker once the job is completed.",
    fr: "Vous pourrez donner votre avis une fois le travail terminé.",
  },
  BOOKING_ALREADY_REVIEWED: {
    en: "You already reviewed this booking.",
    fr: "Vous avez déjà donné votre avis.",
  },
  PENALTY_NOT_FOUND: {
    en: "Penalty not found.",
    fr: "Sanction introuvable.",
  },
  PENALTY_ALREADY_LIFTED: {
    en: "This penalty was already lifted.",
    fr: "Cette sanction a déjà été levée.",
  },
  PENALTY_SOFTEN_ONLY_SUSPENSION: {
    en: "Only a worker's suspension can be softened.",
    fr: "Seule la suspension d'un travailleur peut être allégée.",
  },

  // Job board
  JOB_NOT_FOUND: {
    en: "Job not found.",
    fr: "Offre d'emploi introuvable.",
  },
  JOB_ALREADY_PUBLISHED: {
    en: "Job is already published.",
    fr: "Cette offre est déjà publiée.",
  },
  JOB_CLOSED: {
    en: "This job is not available for applications.",
    fr: "Cette offre n'accepte plus de candidatures.",
  },
  JOB_REMOVED: {
    en: "The Kadou24h team removed this job offer. Contact support to find out more.",
    fr: "L'équipe Kadou24h a retiré cette offre. Contactez le support pour en savoir plus.",
  },
  JOB_ALREADY_REMOVED: {
    en: "This job offer is already removed.",
    fr: "Cette offre est déjà retirée.",
  },
  JOB_NOT_REMOVED: {
    en: "This job offer was not removed.",
    fr: "Cette offre n'a pas été retirée.",
  },
  APPLY_OWN_JOB: {
    en: "You cannot apply to your own job.",
    fr: "Vous ne pouvez pas postuler à votre propre offre.",
  },
  APPLY_OWN_STORE: {
    en: "You cannot apply to your own store.",
    fr: "Vous ne pouvez pas postuler dans votre propre boutique.",
  },
  JOB_ALREADY_APPLIED: {
    en: "You already applied to this job.",
    fr: "Vous avez déjà postulé à cette offre.",
  },
  JOB_APPLICATION_NOT_FOUND: {
    en: "Application not found.",
    fr: "Candidature introuvable.",
  },
  APPLICATION_MANAGE_FORBIDDEN: {
    en: "You are not allowed to manage this application.",
    fr: "Vous n'êtes pas autorisé à gérer cette candidature.",
  },
  APPLICATION_STATUS_INVALID: {
    en: "Use: under_review, shortlisted, hired or rejected (for an interview, schedule it).",
    fr: "Utilisez : under_review, shortlisted, hired ou rejected (pour un entretien, planifiez-le).",
  },
  CANDIDATE_WITHDREW: {
    en: "The candidate withdrew this application.",
    fr: "Le candidat a retiré sa candidature.",
  },
  APPLICATION_WITHDRAW_TOO_LATE: {
    en: "This application can no longer be withdrawn.",
    fr: "Cette candidature ne peut plus être retirée.",
  },
  NO_INTERVIEW: {
    en: "There is no interview to confirm.",
    fr: "Il n'y a pas d'entretien à confirmer.",
  },
  UNLOCK_NOT_YOURS: {
    en: "You can only unlock candidates who applied to your jobs or your store.",
    fr: "Vous ne pouvez débloquer que les personnes qui ont postulé à vos offres ou dans votre boutique.",
  },
  PAYMENT_METHOD_ONLINE: {
    en: "Choose Orange Money, Mobile Money or card.",
    fr: "Choisissez Orange Money, Mobile Money ou carte.",
  },

  // Moto-taxi
  RIDE_NOT_FOUND: {
    en: "Ride not found.",
    fr: "Course introuvable.",
  },
  RIDE_SERVICE_OFF: {
    en: "Moto-taxi is not available right now.",
    fr: "Le moto-taxi n'est pas disponible pour le moment.",
  },
  RIDE_TOO_CLOSE: {
    en: "The pickup and the destination are too close.",
    fr: "Le départ et la destination sont trop proches.",
  },
  RIDE_TOO_LONG: {
    en: "This trip is too long for a moto-taxi.",
    fr: "Ce trajet est trop long pour un moto-taxi.",
  },
  RIDE_ADDRESS_REQUIRED: {
    en: "Say where (neighbourhood, street or landmark).",
    fr: "Précisez où (quartier, rue ou repère).",
  },
  RIDE_IN_PROGRESS: {
    en: "You already have a ride in progress.",
    fr: "Vous avez déjà une course en cours.",
  },
  RIDE_DELETE_IN_PROGRESS: {
    en: "This ride is still in progress: you can delete it once it is over.",
    fr: "Cette course est encore en cours : vous pourrez la supprimer une fois terminée.",
  },
  RIDE_STARTED: {
    en: "The ride has started: it can no longer be cancelled.",
    fr: "La course a commencé : elle ne peut plus être annulée.",
  },
  RIDE_CHANGED: {
    en: "This ride was just updated. Please refresh.",
    fr: "Cette course vient d'être mise à jour. Veuillez actualiser.",
  },
  RIDE_RATE_TOO_EARLY: {
    en: "You can rate a ride once it is finished.",
    fr: "Vous pourrez noter la course une fois terminée.",
  },
  RIDE_ALREADY_RATED: {
    en: "You already rated this ride.",
    fr: "Vous avez déjà noté cette course.",
  },
  RIDE_ONLY_MOTO: {
    en: "Only approved moto riders can take rides.",
    fr: "Seuls les livreurs moto validés peuvent prendre des courses.",
  },
  RIDE_SAFETY_IDS_MISSING: {
    en: "Add your plate and vest number (Profile → My vehicle) to take passengers.",
    fr: "Ajoutez votre plaque et votre numéro de gilet (Profil → Mon véhicule) pour prendre des passagers.",
  },
  RIDE_SUBSCRIPTION_ENDED: {
    en: "Your moto-taxi subscription has ended. Choose a plan to receive passengers again.",
    fr: "Votre abonnement moto-taxi est terminé. Choisissez une formule pour recevoir à nouveau des passagers.",
  },
  GO_ONLINE_FOR_RIDES: {
    en: "Go online to take rides.",
    fr: "Passez en ligne pour prendre des courses.",
  },
  FINISH_DELIVERIES_FIRST: {
    en: "Finish your deliveries before taking a passenger.",
    fr: "Terminez vos livraisons avant de prendre un passager.",
  },
  RIDE_ALREADY_TAKEN: {
    en: "Another rider has already taken this ride.",
    fr: "Un autre chauffeur a déjà pris cette course.",
  },
  RIDE_OWN: {
    en: "You cannot take your own ride.",
    fr: "Vous ne pouvez pas prendre votre propre course.",
  },
  RIDE_NOT_FOR_YOU: {
    en: "This ride is not offered to you.",
    fr: "Cette course ne vous est pas proposée.",
  },
  // Negotiable price (client, 2026-11-21)
  RIDE_BID_OUT_OF_RANGE: {
    en: "Choose a price between {min} and {max}.",
    fr: "Choisissez un prix entre {min} et {max}.",
  },
  RIDE_BID_STEP: {
    en: "The price must go up in steps of {step}.",
    fr: "Le prix doit avancer par paliers de {step}.",
  },
  RIDE_BID_WAITING: {
    en: "You already sent a price for this ride. Wait for the passenger's answer, or take it back.",
    fr: "Vous avez déjà envoyé un prix pour cette course. Attendez la réponse du passager, ou retirez-le.",
  },
  RIDE_BID_ELSEWHERE: {
    en: "You are waiting for an answer on another ride. Take that price back first.",
    fr: "Vous attendez une réponse pour une autre course. Retirez d'abord ce prix.",
  },
  RIDE_BID_LIMIT: {
    en: "You can't send more prices for this ride.",
    fr: "Vous ne pouvez plus envoyer de prix pour cette course.",
  },
  RIDE_BID_GONE: {
    en: "This offer is no longer available. Please refresh.",
    fr: "Cette offre n'est plus disponible. Veuillez actualiser.",
  },
  RIDE_RIDER_UNAVAILABLE: {
    en: "This rider is no longer available. Choose another offer.",
    fr: "Ce chauffeur n'est plus disponible. Choisissez une autre offre.",
  },
  RIDE_COUNTER_OUT_OF_RANGE: {
    en: "Propose a price between {min} and {max}.",
    fr: "Proposez un prix entre {min} et {max}.",
  },
  RIDE_COUNTER_NOT_POSSIBLE: {
    en: "This rider already asks the suggested price: accept or decline it.",
    fr: "Ce chauffeur demande déjà le prix conseillé : acceptez-le ou refusez-le.",
  },
  RIDE_DROP_TOO_LATE: {
    en: "You can only drop a ride before it starts.",
    fr: "Vous ne pouvez abandonner une course qu'avant le départ.",
  },
  RIDE_NOT_IN_PROGRESS: {
    en: "Only a ride in progress can be cancelled.",
    fr: "Seule une course en cours peut être annulée.",
  },
  RIDE_SHARE_OVER: {
    en: "This ride is over: there is nothing to share.",
    fr: "Cette course est terminée : il n'y a rien à partager.",
  },
  SHARE_LINK_INVALID: {
    en: "This link doesn't exist or has expired.",
    fr: "Ce lien n'existe pas ou a expiré.",
  },
} satisfies LocalizedMessages;
