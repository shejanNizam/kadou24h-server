import type { LocalizedMessages } from "./types";

/**
 * Field messages used inside Zod schemas: write the code as the schema message,
 * e.g. `.min(8, { message: "PASSWORD_TOO_SHORT" })`. It is translated when the
 * answer is sent, with {minimum} / {maximum} taken from the failed check.
 */
export const validationErrors = {
  PHONE_FORMAT: {
    en: "Phone must be in international format, e.g. +224620123456.",
    fr: "Le numéro doit être au format international, ex. +224620123456.",
  },
  EMAIL_INVALID: {
    en: "Invalid email address.",
    fr: "Adresse e-mail invalide.",
  },
  IDENTIFIER_INVALID: {
    en: "Enter a valid phone number (e.g. +224620123456) or email.",
    fr: "Saisissez un numéro de téléphone valide (ex. +224620123456) ou une adresse e-mail.",
  },
  PASSWORD_TOO_SHORT: {
    en: "Password must be at least {minimum} characters long.",
    fr: "Le mot de passe doit contenir au moins {minimum} caractères.",
  },
  PASSWORD_TOO_LONG: {
    en: "Password cannot exceed {maximum} characters.",
    fr: "Le mot de passe ne peut pas dépasser {maximum} caractères.",
  },
  PASSWORD_NEEDS_LETTER: {
    en: "Password must contain at least 1 letter.",
    fr: "Le mot de passe doit contenir au moins 1 lettre.",
  },
  PASSWORD_NEEDS_NUMBER: {
    en: "Password must contain at least 1 number.",
    fr: "Le mot de passe doit contenir au moins 1 chiffre.",
  },
  PASSWORD_SAME_AS_OLD: {
    en: "New password cannot be the same as the old password.",
    fr: "Le nouveau mot de passe doit être différent de l'ancien.",
  },
  OTP_FORMAT: {
    en: "The code must be exactly 6 digits.",
    fr: "Le code doit contenir exactement 6 chiffres.",
  },
  NAME_TOO_SHORT: {
    en: "Name must be at least {minimum} characters long.",
    fr: "Le nom doit contenir au moins {minimum} caractères.",
  },
  NAME_TOO_LONG: {
    en: "Name cannot exceed {maximum} characters.",
    fr: "Le nom ne peut pas dépasser {maximum} caractères.",
  },
  URL_INVALID: {
    en: "Must be a valid URL.",
    fr: "Doit être une URL valide.",
  },
  COUNTRY_CODE_INVALID: {
    en: "Country must be a 2-letter code, e.g. GN.",
    fr: "Le pays doit être un code à 2 lettres, ex. GN.",
  },
  MODE_INVALID: {
    en: "Mode must be customer, vendor or rider.",
    fr: "Le mode doit être client, vendeur ou livreur.",
  },
  ROLE_INVALID: {
    en: "Role must be staff or admin.",
    fr: "Le rôle doit être employé ou administrateur.",
  },
  STATUS_REASON_REQUIRED: {
    en: "A reason is required when suspending or banning.",
    fr: "Un motif est obligatoire pour suspendre ou bannir.",
  },
  STATUS_INVALID: {
    en: "Invalid status.",
    fr: "Statut invalide.",
  },
  REASON_TOO_SHORT: {
    en: "The reason must be at least {minimum} characters.",
    fr: "Le motif doit contenir au moins {minimum} caractères.",
  },
  AMOUNT_TOO_LOW: {
    en: "The amount must be at least {minimum, number} GNF.",
    fr: "Le montant doit être d'au moins {minimum, number} GNF.",
  },
  TEXT_TOO_SHORT: {
    en: "Must be at least {minimum} characters.",
    fr: "Doit contenir au moins {minimum} caractères.",
  },
  NUMBER_TOO_LOW: {
    en: "Must be at least {minimum, number}.",
    fr: "Doit être au moins {minimum, number}.",
  },
  NUMBER_TOO_HIGH: {
    en: "Cannot be more than {maximum, number}.",
    fr: "Ne peut pas dépasser {maximum, number}.",
  },
  WHOLE_NUMBER: {
    en: "Must be a whole number.",
    fr: "Doit être un nombre entier.",
  },
  END_DATE_REQUIRED: {
    en: "Choose an end date.",
    fr: "Choisissez une date de fin.",
  },
  END_DATE_BEFORE_START: {
    en: "The end date must be after the start date.",
    fr: "La date de fin doit être postérieure à la date de début.",
  },
  CURRENCY_CODE_INVALID: {
    en: "The currency must be a 3-letter code.",
    fr: "La devise doit être un code de 3 lettres.",
  },
  TEXT_TOO_LONG: {
    en: "Must be at most {maximum} characters.",
    fr: "Doit contenir au plus {maximum} caractères.",
  },
  TIME_FORMAT: {
    en: "Use the HH:mm format.",
    fr: "Utilisez le format HH:mm.",
  },
  PIN_FORMAT: {
    en: "The code must be exactly 4 digits.",
    fr: "Le code doit contenir exactement 4 chiffres.",
  },
} satisfies LocalizedMessages;
