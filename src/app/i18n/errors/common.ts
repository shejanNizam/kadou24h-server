import type { LocalizedMessages } from "./types";

/**
 * Errors shared by the whole API: generic HTTP reasons, request parsing,
 * uploads, rate limits and authentication.
 */
export const commonErrors = {
  // Generic reasons, also used for errors that have no code of their own yet
  BAD_REQUEST: {
    en: "The request is not valid.",
    fr: "La requête n'est pas valide.",
  },
  UNAUTHORIZED: {
    en: "Please log in to continue.",
    fr: "Veuillez vous connecter pour continuer.",
  },
  FORBIDDEN: {
    en: "You are not allowed to do this.",
    fr: "Vous n'êtes pas autorisé à effectuer cette action.",
  },
  NOT_FOUND: {
    en: "Not found.",
    fr: "Introuvable.",
  },
  CONFLICT: {
    en: "This has just changed. Please refresh and try again.",
    fr: "Cet élément vient de changer. Veuillez actualiser et réessayer.",
  },
  UNPROCESSABLE: {
    en: "This request cannot be processed.",
    fr: "Cette requête ne peut pas être traitée.",
  },
  TOO_MANY_REQUESTS: {
    en: "Too many requests, please try again later.",
    fr: "Trop de requêtes, veuillez réessayer plus tard.",
  },
  INTERNAL_ERROR: {
    en: "Something went wrong. Please try again.",
    fr: "Une erreur s'est produite. Veuillez réessayer.",
  },
  SERVICE_UNAVAILABLE: {
    en: "The service is temporarily unavailable. Please try again later.",
    fr: "Le service est momentanément indisponible. Veuillez réessayer plus tard.",
  },

  // Request parsing and validation
  ROUTE_NOT_FOUND: {
    en: "This API route does not exist.",
    fr: "Cette route de l'API n'existe pas.",
  },
  INVALID_JSON: {
    en: "The request body is not valid JSON.",
    fr: "Le corps de la requête n'est pas un JSON valide.",
  },
  INVALID_DATA_FIELD: {
    en: "The data field does not contain valid JSON.",
    fr: "Le champ data ne contient pas de JSON valide.",
  },
  BODY_TOO_LARGE: {
    en: "The request body is too large.",
    fr: "Le corps de la requête est trop volumineux.",
  },
  INVALID_ID: {
    en: "Invalid ID. Please provide a valid ID.",
    fr: "Identifiant invalide. Veuillez fournir un identifiant valide.",
  },
  DUPLICATE_VALUE: {
    en: "This {field} already exists.",
    fr: "Ce {field} existe déjà.",
  },
  VALIDATION_FAILED: {
    en: "Some fields are not valid.",
    fr: "Certains champs ne sont pas valides.",
  },
  FIELD_REQUIRED: {
    en: "This field is required.",
    fr: "Ce champ est obligatoire.",
  },

  // Uploads
  FILE_TOO_LARGE: {
    en: "File too large ({maxMb} MB maximum).",
    fr: "Fichier trop volumineux ({maxMb} Mo maximum).",
  },
  TOO_MANY_FILES: {
    en: "Too many files ({max} maximum).",
    fr: "Trop de fichiers ({max} maximum).",
  },
  INVALID_UPLOAD: {
    en: "The upload is not valid.",
    fr: "Le fichier envoyé n'est pas valide.",
  },
  FILE_TYPE_NOT_ALLOWED: {
    en: "Only photos (JPG, PNG, WebP, HEIC), voice messages and PDF files can be uploaded.",
    fr: "Seuls les photos (JPG, PNG, WebP, HEIC), les messages vocaux et les fichiers PDF peuvent être envoyés.",
  },

  // Rate limits
  TOO_MANY_AUTH_ATTEMPTS: {
    en: "Too many attempts, please try again later.",
    fr: "Trop de tentatives, veuillez réessayer plus tard.",
  },
  TOO_MANY_CODE_REQUESTS: {
    en: "Too many code requests, please try again later.",
    fr: "Trop de demandes de code, veuillez réessayer plus tard.",
  },
  TOO_MANY_UPLOADS: {
    en: "Too many uploads, please try again later.",
    fr: "Trop d'envois de fichiers, veuillez réessayer plus tard.",
  },
  TOO_MANY_REPORTS: {
    en: "Too many reports, please try again later.",
    fr: "Trop de signalements, veuillez réessayer plus tard.",
  },

  // Authentication (checkAuth, reset token)
  TOKEN_MISSING: {
    en: "Please log in to continue.",
    fr: "Veuillez vous connecter pour continuer.",
  },
  TOKEN_INVALID: {
    en: "Your session is invalid or has expired. Please log in again.",
    fr: "Votre session est invalide ou a expiré. Veuillez vous reconnecter.",
  },
  ACCOUNT_NOT_FOUND: {
    en: "This account does not exist.",
    fr: "Ce compte n'existe pas.",
  },
  SESSION_EXPIRED: {
    en: "Session expired. Please log in again.",
    fr: "Session expirée. Veuillez vous reconnecter.",
  },
  ACCOUNT_NOT_VERIFIED: {
    en: "Your account is not verified.",
    fr: "Votre compte n'est pas vérifié.",
  },
  ACCOUNT_SUSPENDED: {
    en: "{reason, select, none {Your account is suspended.} other {Your account is suspended: {reason}}}",
    fr: "{reason, select, none {Votre compte est suspendu.} other {Votre compte est suspendu : {reason}}}",
  },
  ACCOUNT_BANNED: {
    en: "{reason, select, none {Your account is banned.} other {Your account is banned: {reason}}}",
    fr: "{reason, select, none {Votre compte est banni.} other {Votre compte est banni : {reason}}}",
  },
  ROLE_NOT_ALLOWED: {
    en: "You are not permitted to access this route.",
    fr: "Vous n'avez pas accès à cette fonctionnalité.",
  },
  RESET_TOKEN_MISSING: {
    en: "No reset token provided.",
    fr: "Aucun jeton de réinitialisation fourni.",
  },
  RESET_TOKEN_INVALID: {
    en: "The reset link is invalid or has expired. Please start again.",
    fr: "Le lien de réinitialisation est invalide ou a expiré. Veuillez recommencer.",
  },

  // Profiles many modules look up
  VENDOR_PROFILE_NOT_FOUND: {
    en: "Vendor profile not found.",
    fr: "Profil vendeur introuvable.",
  },
  RIDER_PROFILE_NOT_FOUND: {
    en: "Rider profile not found.",
    fr: "Profil livreur introuvable.",
  },
  STORE_NOT_FOUND: {
    en: "Store not found.",
    fr: "Boutique introuvable.",
  },

  // Files, email and SMS
  FILE_REQUIRED: {
    en: "No file provided.",
    fr: "Aucun fichier fourni.",
  },
  UPLOAD_FAILED: {
    en: "The file could not be uploaded. Please try again.",
    fr: "Le fichier n'a pas pu être envoyé. Veuillez réessayer.",
  },
  FILE_DELETE_FAILED: {
    en: "The file could not be deleted.",
    fr: "Le fichier n'a pas pu être supprimé.",
  },
  EMAIL_NOT_SENT: {
    en: "The email could not be sent. Please try again.",
    fr: "L'e-mail n'a pas pu être envoyé. Veuillez réessayer.",
  },
  SMS_NOT_CONFIGURED: {
    en: "Sending SMS is not configured.",
    fr: "L'envoi de SMS n'est pas configuré.",
  },

  // Sessions and Google / Apple sign-in
  REFRESH_TOKEN_INVALID: {
    en: "Your session is invalid or has expired. Please log in again.",
    fr: "Votre session est invalide ou a expiré. Veuillez vous reconnecter.",
  },
  OAUTH_UNREACHABLE: {
    en: "Could not reach {provider, select, google {Google} apple {Apple} other {{provider}}} to verify sign-in. Please try again.",
    fr: "Impossible de joindre {provider, select, google {Google} apple {Apple} other {{provider}}} pour vérifier la connexion. Veuillez réessayer.",
  },
  OAUTH_NOT_CONFIGURED: {
    en: "{provider, select, google {Google} apple {Apple} other {{provider}}} sign-in is not configured.",
    fr: "La connexion avec {provider, select, google {Google} apple {Apple} other {{provider}}} n'est pas configurée.",
  },
  OAUTH_TOKEN_INVALID: {
    en: "Invalid or expired sign-in. Please try again.",
    fr: "Connexion invalide ou expirée. Veuillez réessayer.",
  },

  // Query strings
  QUERY_VALUE_INVALID: {
    en: 'Invalid {name} "{value}". Allowed: {allowed}.',
    fr: "Valeur « {value} » invalide pour {name}. Valeurs permises : {allowed}.",
  },
} satisfies LocalizedMessages;
