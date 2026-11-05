import type { LocalizedMessages } from "./types";

/** Wallets, payout methods, withdrawals and the cash riders collect (COD settlements). */
export const walletErrors = {
  WALLET_MODE_INVALID: {
    en: "The mode must be vendor or rider.",
    fr: "Le mode doit être vendeur ou livreur.",
  },
  WALLET_NOT_FOUND: {
    en: "Wallet not found.",
    fr: "Portefeuille introuvable.",
  },

  // Payout methods
  PAYOUT_METHODS_LIMIT: {
    en: "You can save up to {max} payout methods.",
    fr: "Vous pouvez enregistrer jusqu'à {max} moyens de retrait.",
  },
  PAYOUT_METHOD_NOT_FOUND: {
    en: "Payout method not found.",
    fr: "Moyen de retrait introuvable.",
  },
  BANK_NAME_REQUIRED: {
    en: "The bank name is required for bank accounts.",
    fr: "Le nom de la banque est obligatoire pour un compte bancaire.",
  },

  // Withdrawals
  INSUFFICIENT_BALANCE: {
    en: "Insufficient available balance. Available: {available, number} GNF, requested: {requested, number} GNF.",
    fr: "Solde disponible insuffisant. Disponible : {available, number} GNF, demandé : {requested, number} GNF.",
  },
  WITHDRAW_CASH_OWED: {
    en: "Cannot withdraw {amount, number} GNF: you owe {owed, number} GNF in unremitted COD cash. Maximum withdrawable: {max, number} GNF.",
    fr: "Retrait de {amount, number} GNF impossible : vous devez encore reverser {owed, number} GNF de cash encaissé à la livraison. Maximum retirable : {max, number} GNF.",
  },
  WITHDRAWAL_CONCURRENT: {
    en: "Insufficient available balance or concurrent withdrawal in progress.",
    fr: "Solde disponible insuffisant, ou un autre retrait est en cours.",
  },
  WITHDRAWAL_NOT_FOUND: {
    en: "Withdrawal request not found.",
    fr: "Demande de retrait introuvable.",
  },
  WITHDRAWAL_ALREADY_HANDLED: {
    en: "Withdrawal has already been {status, select, approved {approved} completed {completed} rejected {rejected} other {handled}}.",
    fr: "Ce retrait a déjà été {status, select, approved {approuvé} completed {effectué} rejected {refusé} other {traité}}.",
  },
  WITHDRAWAL_CONFLICT: {
    en: "Withdrawal was just processed by someone else.",
    fr: "Ce retrait vient d'être traité par quelqu'un d'autre.",
  },
  WITHDRAWAL_TOO_LOW: {
    en: "Minimum withdrawal amount is {minimum, number} GNF.",
    fr: "Le montant minimum de retrait est de {minimum, number} GNF.",
  },

  // Cash collected at delivery (COD settlements)
  SETTLEMENT_ABOVE_OWED: {
    en: "Settlement amount cannot exceed the cash you still owe ({owed, number} GNF).",
    fr: "Le montant ne peut pas dépasser le cash que vous devez encore ({owed, number} GNF).",
  },
  OFFSET_INSUFFICIENT: {
    en: "Insufficient available balance for offset. Available: {available, number} GNF.",
    fr: "Vos gains disponibles ne suffisent pas. Disponible : {available, number} GNF.",
  },
  SETTLEMENT_NOT_FOUND: {
    en: "Settlement not found.",
    fr: "Déclaration de versement introuvable.",
  },
  SETTLEMENT_ALREADY_HANDLED: {
    en: "Settlement is already {status, select, confirmed {confirmed} rejected {rejected} other {handled}}.",
    fr: "Cette déclaration est déjà {status, select, confirmed {confirmée} rejected {refusée} other {traitée}}.",
  },
  COD_REJECTION_REASON_REQUIRED: {
    en: "Tell the rider why the declaration is rejected.",
    fr: "Expliquez au livreur pourquoi la déclaration est refusée.",
  },
} satisfies LocalizedMessages;
