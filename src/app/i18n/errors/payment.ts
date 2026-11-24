import type { LocalizedMessages } from "./types";

/** Online payments, the gateway, refunds and disputes. */
export const paymentErrors = {
  // Gateway
  PAYMENT_UNAVAILABLE: {
    en: "Online payment is not available right now. Please try again later.",
    fr: "Le paiement en ligne n'est pas disponible pour le moment. Veuillez réessayer plus tard.",
  },
  PAYMENT_WEBHOOK_NOT_CONFIGURED: {
    en: "Payment webhook is not configured.",
    fr: "Le webhook de paiement n'est pas configuré.",
  },
  WEBHOOK_SECRET_INVALID: {
    en: "Invalid webhook secret.",
    fr: "Secret du webhook invalide.",
  },
  PAYMENT_AMOUNT_MISMATCH: {
    en: "Amount mismatch: expected {expected, number} GNF, gateway reported {reported, number} GNF.",
    fr: "Montant différent : {expected, number} GNF attendus, {reported, number} GNF annoncés par la passerelle.",
  },

  // Paying
  IDEMPOTENCY_KEY_CONFLICT: {
    en: "This payment request belongs to another account.",
    fr: "Cette demande de paiement appartient à un autre compte.",
  },
  PAYMENT_ONLINE_ONLY: {
    en: "This payment can only be made online (Orange Money, Mobile Money or card).",
    fr: "Ce paiement se fait uniquement en ligne (Orange Money, Mobile Money ou carte).",
  },
  ORDER_PAY_FORBIDDEN: {
    en: "You cannot pay for this order.",
    fr: "Vous ne pouvez pas payer cette commande.",
  },
  ORDER_ALREADY_PAID: {
    en: "Order is already paid.",
    fr: "La commande est déjà payée.",
  },
  COD_PAID_TO_RIDER: {
    en: "Cash on delivery orders are paid to the rider.",
    fr: "Les commandes payées à la livraison se règlent auprès du livreur.",
  },
  FEES_ALREADY_PAID: {
    en: "The fees of this order are already paid.",
    fr: "Les frais de cette commande sont déjà payés.",
  },
  FEES_PAY_ONLINE: {
    en: "Pay the fees online (Orange Money, Mobile Money or card).",
    fr: "Payez les frais en ligne (Orange Money, Mobile Money ou carte).",
  },
  ORDER_WAS_CANCELLED: {
    en: "This order was cancelled.",
    fr: "Cette commande a été annulée.",
  },
  PAYMENT_TIME_OVER: {
    en: "The time to pay for this order is over. It will be cancelled and the items put back in your cart.",
    fr: "Le délai de paiement est dépassé. La commande va être annulée et les articles remis dans votre panier.",
  },
  SUBSCRIPTION_PLAN_NOT_FOUND: {
    en: "This subscription plan is not available.",
    fr: "Cette formule d'abonnement n'est pas disponible.",
  },
  PAYMENT_LOOKUP_REQUIRED: {
    en: "paymentId, idempotencyKey or providerRef is required.",
    fr: "paymentId, idempotencyKey ou providerRef est obligatoire.",
  },
  PAYMENT_NOT_FOUND: {
    en: "Payment record not found.",
    fr: "Paiement introuvable.",
  },

  // Refunds
  REFUND_NOT_FOUND: {
    en: "Refund request not found.",
    fr: "Demande de remboursement introuvable.",
  },
  REFUND_ALREADY_HANDLED: {
    en: "This refund was already {status, select, completed {completed} rejected {rejected} other {handled}}.",
    fr: "Ce remboursement a déjà été {status, select, completed {effectué} rejected {refusé} other {traité}}.",
  },
  REFUND_CONFLICT: {
    en: "This refund was just handled by someone else.",
    fr: "Ce remboursement vient d'être traité par quelqu'un d'autre.",
  },
  REFUND_ABOVE_REQUESTED: {
    en: "You can approve at most the requested {amount, number} GNF.",
    fr: "Vous pouvez approuver au maximum les {amount, number} GNF demandés.",
  },
  REFUND_ABOVE_LEFT: {
    en: "Only {left, number} GNF is left to refund on this order.",
    fr: "Il ne reste que {left, number} GNF à rembourser sur cette commande.",
  },
  REFUND_EXCEEDS_LEFT: {
    en: "Refund amount ({amount, number} GNF) exceeds what is left to refund ({left, number} GNF){waiting, plural, =0 {} other {; # GNF is already waiting in a pending request — approve that one instead}}.",
    fr: "Le montant ({amount, number} GNF) dépasse ce qui reste à rembourser ({left, number} GNF){waiting, plural, =0 {} other { ; # GNF attendent déjà dans une demande en cours : approuvez plutôt celle-ci}}.",
  },
  REFUND_NOTHING_PAID: {
    en: "This order has not been paid (cash on delivery orders are paid at delivery) — nothing to refund. Cancel it instead.",
    fr: "Cette commande n'a pas été payée (le paiement à la livraison se fait à la réception) : rien à rembourser. Annulez-la plutôt.",
  },
  REFUND_AMOUNT_REQUIRED: {
    en: "Enter the refund amount.",
    fr: "Saisissez le montant à rembourser.",
  },
  REFUND_REJECTION_REASON_REQUIRED: {
    en: "Explain to the customer why the refund is rejected.",
    fr: "Expliquez au client pourquoi le remboursement est refusé.",
  },

  // Disputes
  DISPUTE_FORBIDDEN: {
    en: "You cannot open a dispute on this order.",
    fr: "Vous ne pouvez pas ouvrir de litige sur cette commande.",
  },
  DISPUTE_NOT_DELIVERED: {
    en: "This part of the order was not delivered: you can only report a delivery problem once it has been delivered.",
    fr: "Cette partie de la commande n'a pas été livrée : un problème de livraison ne peut être signalé qu'après la livraison.",
  },
  DISPUTE_NOTHING_PAID: {
    en: "Nothing was paid online for this order: there is no payment to dispute.",
    fr: "Rien n'a été payé en ligne pour cette commande : il n'y a pas de paiement à contester.",
  },
  DISPUTE_ALREADY_OPEN: {
    en: "You already reported a problem here: our team is looking into it.",
    fr: "Vous avez déjà signalé un problème ici : notre équipe s'en occupe.",
  },
  DISPUTE_NOT_FOUND: {
    en: "Dispute not found.",
    fr: "Litige introuvable.",
  },
  DISPUTE_ALREADY_HANDLED: {
    en: "This dispute has already been {status, select, resolved {resolved} rejected {rejected} other {handled}}.",
    fr: "Ce litige a déjà été {status, select, resolved {résolu} rejected {rejeté} other {traité}}.",
  },
  DISPUTE_CONFLICT: {
    en: "This dispute was just handled by someone else.",
    fr: "Ce litige vient d'être traité par quelqu'un d'autre.",
  },
} satisfies LocalizedMessages;
