import type { LocalizedMessages } from "./types";

/** Chat, notifications, support tickets and reports. */
export const chatErrors = {
  // Chat
  CONVERSATION_NOT_FOUND: {
    en: "Conversation not found.",
    fr: "Conversation introuvable.",
  },
  MESSAGE_NOT_FOUND: {
    en: "Message not found.",
    fr: "Message introuvable.",
  },
  VIOLATION_NOT_FOUND: {
    en: "Violation not found.",
    fr: "Infraction introuvable.",
  },
  NOT_CONVERSATION_PARTICIPANT: {
    en: "You are not a participant in this conversation.",
    fr: "Vous ne faites pas partie de cette conversation.",
  },
  NOBODY_TO_BLOCK: {
    en: "There is nobody to block in this conversation.",
    fr: "Il n'y a personne à bloquer dans cette conversation.",
  },
  CHAT_ACCOUNT_SUSPENDED: {
    en: "Your account is suspended. You cannot send messages.",
    fr: "Votre compte est suspendu. Vous ne pouvez pas envoyer de messages.",
  },
  CHAT_RESTRICTED: {
    en: "Your chat is temporarily restricted until {until, date, dayTime} due to policy violations.",
    fr: "Votre messagerie est temporairement restreinte jusqu'au {until, date, dayTime} pour non-respect des règles.",
  },
  VOICE_NOT_ALLOWED: {
    en: "Voice notes are not available in this chat.",
    fr: "Les messages vocaux ne sont pas disponibles dans cette conversation.",
  },
  MESSAGE_CONTENT_REQUIRED: {
    en: "Text is required for text messages, mediaUrl for voice and image messages.",
    fr: "Le texte est obligatoire pour un message texte, mediaUrl pour un message vocal ou une image.",
  },
  CHAT_SELF: {
    en: "You cannot start a conversation with yourself.",
    fr: "Vous ne pouvez pas démarrer une conversation avec vous-même.",
  },
  CHAT_TARGET_REQUIRED: {
    en: "workerProfileId or bookingId is required.",
    fr: "workerProfileId ou bookingId est obligatoire.",
  },
  CHAT_ORDER_UNPAID: {
    en: "Pay for this order first — the store receives it once paid.",
    fr: "Payez d'abord la commande : la boutique la reçoit dès le paiement.",
  },
  NOT_PART_OF_ORDER: {
    en: "You are not part of this order.",
    fr: "Vous ne faites pas partie de cette commande.",
  },
  NOT_PART_OF_BOOKING: {
    en: "You are not part of this booking.",
    fr: "Vous ne faites pas partie de cette réservation.",
  },
  NOT_PART_OF_APPLICATION: {
    en: "You are not part of this application.",
    fr: "Vous ne faites pas partie de cette candidature.",
  },
  NO_RIDER_YET: {
    en: "No rider is assigned to this order yet.",
    fr: "Aucun livreur n'est encore assigné à cette commande.",
  },

  // Notifications
  NOTIFICATION_NOT_FOUND: {
    en: "Notification not found.",
    fr: "Notification introuvable.",
  },
  DEVICE_TOKEN_INVALID: {
    en: "Invalid device token.",
    fr: "Jeton d'appareil invalide.",
  },

  // Support tickets and reports
  TICKET_NOT_FOUND: {
    en: "Support ticket not found.",
    fr: "Demande d'assistance introuvable.",
  },
  TICKET_FORBIDDEN: {
    en: "You do not have permission to view this ticket.",
    fr: "Vous n'avez pas accès à cette demande d'assistance.",
  },
  STAFF_NOT_FOUND: {
    en: "Assigned staff member not found.",
    fr: "Membre de l'équipe introuvable.",
  },
  REPORT_NOT_FOUND: {
    en: "Report not found.",
    fr: "Signalement introuvable.",
  },
} satisfies LocalizedMessages;
