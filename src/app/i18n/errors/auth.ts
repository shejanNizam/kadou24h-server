import type { LocalizedMessages } from "./types";

/** Sign-up, sign-in, codes (OTP), passwords, the account itself and the team. */
export const authErrors = {
  // Sign-up and sign-in
  REFRESH_TOKEN_REQUIRED: {
    en: "Refresh token is required.",
    fr: "Le jeton de rafraîchissement est obligatoire.",
  },
  PHONE_ALREADY_REGISTERED: {
    en: "An account with this phone number already exists. Please log in.",
    fr: "Un compte existe déjà avec ce numéro de téléphone. Veuillez vous connecter.",
  },
  EMAIL_TAKEN: {
    en: "This email is already in use.",
    fr: "Cette adresse e-mail est déjà utilisée.",
  },
  REFERRAL_CODE_INVALID: {
    en: "Invalid referral code.",
    fr: "Code de parrainage invalide.",
  },
  ACCOUNT_ALREADY_VERIFIED: {
    en: "This account is already verified. Please log in.",
    fr: "Ce compte est déjà vérifié. Veuillez vous connecter.",
  },
  ACCOUNT_HAS_NO_PHONE: {
    en: "This account has no phone number.",
    fr: "Ce compte n'a pas de numéro de téléphone.",
  },
  INVALID_CREDENTIALS: {
    en: "Invalid phone/email or password.",
    fr: "Téléphone/e-mail ou mot de passe incorrect.",
  },
  LOGIN_LOCKED: {
    en: "Too many wrong passwords. Try again in {minutes} min or reset your password.",
    fr: "Trop de mots de passe incorrects. Réessayez dans {minutes} min ou réinitialisez votre mot de passe.",
  },
  SOCIAL_ACCOUNT_NO_PASSWORD: {
    en: "This account uses Google or Apple sign-in. Continue with it, or reset your password.",
    fr: "Ce compte utilise la connexion Google ou Apple. Continuez avec celle-ci, ou réinitialisez votre mot de passe.",
  },
  SOCIAL_EMAIL_NOT_VERIFIED: {
    en: "Your {provider} account has no verified email. Please sign up with your phone number.",
    fr: "Votre compte {provider} n'a pas d'adresse e-mail vérifiée. Veuillez vous inscrire avec votre numéro de téléphone.",
  },

  // Passwords
  PASSWORD_NOT_SET: {
    en: "No password set yet. Set a password first.",
    fr: "Aucun mot de passe n'est encore défini. Définissez d'abord un mot de passe.",
  },
  PASSWORD_ALREADY_SET: {
    en: "A password is already set. Change it instead.",
    fr: "Un mot de passe est déjà défini. Modifiez-le plutôt.",
  },
  OLD_PASSWORD_WRONG: {
    en: "Old password does not match.",
    fr: "L'ancien mot de passe est incorrect.",
  },
  RESET_CODE_USED: {
    en: "This reset code was already used. Please start again.",
    fr: "Ce code de réinitialisation a déjà été utilisé. Veuillez recommencer.",
  },

  // Codes sent by SMS / email
  OTP_EXPIRED: {
    en: "Code expired or not found. Please request a new one.",
    fr: "Code expiré ou introuvable. Veuillez en demander un nouveau.",
  },
  OTP_INVALID: {
    en: "Invalid code. {remaining, plural, one {# attempt} other {# attempts}} remaining.",
    fr: "Code invalide. {remaining, plural, one {# tentative restante} other {# tentatives restantes}}.",
  },
  OTP_TOO_MANY_ATTEMPTS: {
    en: "Too many failed attempts. Please request a new code.",
    fr: "Trop de tentatives échouées. Veuillez demander un nouveau code.",
  },
  OTP_COOLDOWN: {
    en: "Please wait {seconds}s before requesting a new code.",
    fr: "Veuillez patienter {seconds} s avant de demander un nouveau code.",
  },
  OTP_DAILY_LIMIT: {
    en: "Daily code limit reached. Please try again tomorrow or contact support.",
    fr: "Limite quotidienne de codes atteinte. Réessayez demain ou contactez le support.",
  },
  OTP_SERVICE_PAUSED: {
    en: "Codes are temporarily unavailable. Please try again later or contact support.",
    fr: "Les codes sont momentanément indisponibles. Réessayez plus tard ou contactez le support.",
  },
  OTP_SEND_FAILED: {
    en: "Could not send the verification code. Please try again.",
    fr: "Impossible d'envoyer le code de vérification. Veuillez réessayer.",
  },

  // The account
  MODE_CUSTOMER_NOT_ALLOWED: {
    en: "This account cannot use customer mode.",
    fr: "Ce compte ne peut pas utiliser le mode client.",
  },
  MODE_NOT_APPROVED: {
    en: "{mode, select, vendor {You are not an approved vendor yet.} rider {You are not an approved rider yet.} other {You are not approved for this mode yet.}}",
    fr: "{mode, select, vendor {Vous n'êtes pas encore un vendeur approuvé.} rider {Vous n'êtes pas encore un livreur approuvé.} other {Vous n'êtes pas encore approuvé pour ce mode.}}",
  },
  PHONE_TAKEN: {
    en: "This phone number is already used by another account.",
    fr: "Ce numéro de téléphone est déjà utilisé par un autre compte.",
  },
  PHONE_UNCHANGED: {
    en: "This is already your verified phone number.",
    fr: "C'est déjà votre numéro de téléphone vérifié.",
  },
  DELETE_BLOCKED_ORDERS: {
    en: "You have orders in progress. Wait until they are delivered or cancel them before deleting your account.",
    fr: "Vous avez des commandes en cours. Attendez leur livraison ou annulez-les avant de supprimer votre compte.",
  },
  DELETE_BLOCKED_STORE_ORDERS: {
    en: "Your store has orders in progress. Finish or cancel them before deleting your account.",
    fr: "Votre boutique a des commandes en cours. Terminez-les ou annulez-les avant de supprimer votre compte.",
  },
  DELETE_BLOCKED_DELIVERIES: {
    en: "You have deliveries in progress. Finish them before deleting your account.",
    fr: "Vous avez des livraisons en cours. Terminez-les avant de supprimer votre compte.",
  },
  DELETE_BLOCKED_CASH: {
    en: "You still hold cash on delivery money. Hand it over before deleting your account.",
    fr: "Vous détenez encore de l'argent du paiement à la livraison. Remettez-le avant de supprimer votre compte.",
  },
  DELETE_BLOCKED_WALLET: {
    en: "Your wallet still has money. Withdraw your balance before deleting your account.",
    fr: "Votre portefeuille contient encore de l'argent. Retirez votre solde avant de supprimer votre compte.",
  },

  // Team (admin)
  SUPER_ADMIN_UNDELETABLE: {
    en: "The super admin account cannot be deleted.",
    fr: "Le compte super administrateur ne peut pas être supprimé.",
  },
  SUPER_ADMIN_PROTECTED: {
    en: "The super admin account cannot be modified.",
    fr: "Le compte super administrateur ne peut pas être modifié.",
  },
  SELF_ACTION_FORBIDDEN: {
    en: "You cannot perform this action on your own account.",
    fr: "Vous ne pouvez pas effectuer cette action sur votre propre compte.",
  },
  SUPER_ADMIN_ONLY: {
    en: "Only the super admin can manage team members.",
    fr: "Seul le super administrateur peut gérer les membres de l'équipe.",
  },
  NOT_TEAM_MEMBER: {
    en: "This user is not a team member.",
    fr: "Cet utilisateur n'est pas membre de l'équipe.",
  },

  // Applications (vendor, rider, worker profiles)
  APPLICATION_UNDER_REVIEW: {
    en: "Your application is under review and cannot be edited now.",
    fr: "Votre demande est en cours d'examen et ne peut pas être modifiée pour le moment.",
  },
  APPLICATION_LOCKED: {
    en: "This application is already {status, select, approved {approved} rejected {rejected} suspended {suspended} pending {under review} other {closed}} and cannot be edited.",
    fr: "Cette demande est déjà {status, select, approved {approuvée} rejected {refusée} suspended {suspendue} pending {en cours d'examen} other {clôturée}} et ne peut pas être modifiée.",
  },
  APPLICATION_REVIEW_NOT_ALLOWED: {
    en: "This action is not possible on an application that is {status, select, draft {still a draft} pending {under review} approved {approved} rejected {rejected} needs_changes {waiting for changes} suspended {suspended} other {in this state}}.",
    fr: "Cette action n'est pas possible sur une demande {status, select, draft {encore en brouillon} pending {en cours d'examen} approved {approuvée} rejected {refusée} needs_changes {en attente de modifications} suspended {suspendue} other {dans cet état}}.",
  },
} satisfies LocalizedMessages;
