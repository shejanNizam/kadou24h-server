import type { LocalizedMessages } from "./types";

/** The help assistant (AI). */
export const assistantErrors = {
  ASSISTANT_UNAVAILABLE: {
    en: "The assistant is not available right now. Please contact the support team.",
    fr: "L'assistant n'est pas disponible pour le moment. Veuillez contacter l'équipe d'assistance.",
  },
  ASSISTANT_DAILY_LIMIT: {
    en: "You have asked {limit} questions today, the daily maximum. Try again tomorrow or contact the support team.",
    fr: "Vous avez posé {limit} questions aujourd'hui, le maximum par jour. Réessayez demain ou contactez l'équipe d'assistance.",
  },
  ASSISTANT_BUSY: {
    en: "The assistant is very busy today. Please contact the support team.",
    fr: "L'assistant est très sollicité aujourd'hui. Veuillez contacter l'équipe d'assistance.",
  },
  ASSISTANT_FAILED: {
    en: "The assistant could not answer. Please try again in a moment.",
    fr: "L'assistant n'a pas pu répondre. Veuillez réessayer dans un instant.",
  },
  ASSISTANT_NOTHING_TO_SEND: {
    en: "Ask the assistant a question first, or write your request to the support team directly.",
    fr: "Posez d'abord une question à l'assistant, ou écrivez directement à l'équipe d'assistance.",
  },
  ASSISTANT_TOO_FAST: {
    en: "Please wait a moment before asking another question.",
    fr: "Patientez un instant avant de poser une autre question.",
  },
} satisfies LocalizedMessages;
