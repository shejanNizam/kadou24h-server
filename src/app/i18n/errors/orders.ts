import type { LocalizedMessages } from "./types";

/** A store's part of an order (SubOrderStatus), as words */
const subOrderStatus = (arg: string) => ({
  en: `{${arg}, select, pending_payment {awaiting payment} new {new} accepted {accepted} preparing {being prepared} ready_for_pickup {ready for pickup} in_delivery {in delivery} delivered {delivered} cancelled {cancelled} other {{${arg}}}}`,
  fr: `{${arg}, select, pending_payment {en attente de paiement} new {nouvelle} accepted {acceptée} preparing {en préparation} ready_for_pickup {prête pour l'enlèvement} in_delivery {en livraison} delivered {livrée} cancelled {annulée} other {{${arg}}}}`,
});

const from = subOrderStatus("from");
const to = subOrderStatus("to");

/** Checkout, the customer's orders and each store's part of them (sub-orders). */
export const orderErrors = {
  // Finding orders
  ORDER_NOT_FOUND: {
    en: "Order not found.",
    fr: "Commande introuvable.",
  },
  SUB_ORDER_NOT_FOUND: {
    en: "Sub-order not found.",
    fr: "Sous-commande introuvable.",
  },

  // Checkout: address and intercity station
  ADDRESS_REQUIRED: {
    en: "Please provide or select a delivery address.",
    fr: "Veuillez saisir ou choisir une adresse de livraison.",
  },
  STATION_REQUIRED: {
    en: "Please choose a destination bus station.",
    fr: "Veuillez choisir une gare routière de destination.",
  },
  STATION_UNAVAILABLE: {
    en: "This bus station is not available.",
    fr: "Cette gare routière n'est pas disponible.",
  },
  NO_TRANSIT_STATIONS: {
    en: "No active transit stations configured for intercity delivery.",
    fr: "Aucune gare routière n'est disponible pour la livraison interurbaine.",
  },
  STATION_SAME_CITY: {
    en: "This station is in the store's own city — choose home delivery instead.",
    fr: "Cette gare est dans la ville de la boutique : choisissez plutôt la livraison à domicile.",
  },

  // Checkout: cart, products and stores
  CART_EMPTY: {
    en: "Your cart is empty. Add items before checking out.",
    fr: "Votre panier est vide. Ajoutez des articles avant de commander.",
  },
  PRODUCT_NOT_FOUND: {
    en: "This product no longer exists.",
    fr: "Ce produit n'existe plus.",
  },
  PRODUCT_NOT_APPROVED: {
    en: 'Product "{name}" is not approved for sale.',
    fr: "Le produit « {name} » n'est pas autorisé à la vente.",
  },
  PRODUCT_UNAVAILABLE: {
    en: 'Product "{name}" is marked unavailable by the store.',
    fr: "Le produit « {name} » est indiqué comme indisponible par la boutique.",
  },
  INSUFFICIENT_STOCK: {
    en: 'Insufficient stock for "{name}". Available: {available}, requested: {requested}.',
    fr: "Stock insuffisant pour « {name} ». Disponible : {available}, demandé : {requested}.",
  },
  OUT_OF_STOCK_DURING_CHECKOUT: {
    en: 'Item "{name}" ran out of stock during checkout. Please try again.',
    fr: "L'article « {name} » vient d'être épuisé pendant votre commande. Veuillez réessayer.",
  },
  STORE_NOT_APPROVED: {
    en: 'Store "{store}" is not currently approved to accept orders.',
    fr: "La boutique « {store} » n'est pas autorisée à recevoir des commandes pour le moment.",
  },
  STORE_CLOSED: {
    en: 'Store "{store}" is currently closed.',
    fr: "La boutique « {store} » est actuellement fermée.",
  },
  OWN_STORE_PURCHASE: {
    en: 'You cannot purchase items from your own store ("{store}").',
    fr: "Vous ne pouvez pas acheter dans votre propre boutique (« {store} »).",
  },
  STORE_NO_LONGER_AVAILABLE: {
    en: "The store of {subOrderNumber} is no longer available.",
    fr: "La boutique de {subOrderNumber} n'est plus disponible.",
  },
  COD_LIMIT: {
    en: "Cash on delivery is not available above {limit, number} GNF per store. Please pay online.",
    fr: "Le paiement à la livraison est limité à {limit, number} GNF par boutique. Payez en ligne.",
  },

  // The customer cancels or deletes
  ORDER_ALREADY_CANCELLED: {
    en: "Order is already cancelled.",
    fr: "La commande est déjà annulée.",
  },
  ORDER_CANCEL_TOO_LATE: {
    en: "Cannot cancel order. One or more items are already being prepared or in delivery.",
    fr: "Impossible d'annuler la commande : des articles sont déjà en préparation ou en livraison.",
  },
  PART_CANCEL_UNPAID: {
    en: "Pay for this order first, or cancel the whole order.",
    fr: "Payez d'abord la commande, ou annulez-la entièrement.",
  },
  PART_CANCEL_PREPARING: {
    en: "This store has already started preparing your order: it can no longer be cancelled.",
    fr: "Cette boutique a déjà commencé à préparer votre commande : elle ne peut plus être annulée.",
  },
  ORDER_CANCEL_CONFLICT: {
    en: "This order can no longer be cancelled — it was just updated. Please refresh.",
    fr: "Cette commande ne peut plus être annulée : elle vient d'être mise à jour. Veuillez actualiser.",
  },
  ORDER_DELETE_IN_PROGRESS: {
    en: "This order is still in progress: you can delete it once it is finished.",
    fr: "Cette commande est encore en cours : vous pourrez la supprimer une fois terminée.",
  },
  ORDER_DELETE_REFUND_PENDING: {
    en: "A refund for this order is still being processed: you can delete it once it is done.",
    fr: "Un remboursement est en cours pour cette commande : vous pourrez la supprimer une fois terminé.",
  },
  ORDER_DELETE_DISPUTE_OPEN: {
    en: "A problem you reported on this order is still being handled: you can delete it once it is closed.",
    fr: "Un problème signalé sur cette commande est en cours de traitement : vous pourrez la supprimer une fois clos.",
  },

  // The store works on its part (sub-order)
  SUB_ORDER_ALREADY_CANCELLED: {
    en: "Sub-order is already cancelled.",
    fr: "La sous-commande est déjà annulée.",
  },
  SUB_ORDER_DELIVERED_REFUND: {
    en: "Sub-order is already delivered — issue a refund instead of cancelling.",
    fr: "La sous-commande est déjà livrée : faites un remboursement au lieu de l'annuler.",
  },
  SUB_ORDER_TRANSITION_INVALID: {
    en: `This order cannot go from "${from.en}" to "${to.en}".`,
    fr: `Cette commande ne peut pas passer de « ${from.fr} » à « ${to.fr} ».`,
  },
  SUB_ORDER_CONFLICT: {
    en: "This order was just updated (it may have been cancelled). Please refresh.",
    fr: "Cette commande vient d'être mise à jour (elle a peut-être été annulée). Veuillez actualiser.",
  },
  SUB_ORDER_CANCEL_TOO_LATE: {
    en: "Cannot cancel the order once it is ready for pickup or in delivery.",
    fr: "Impossible d'annuler la commande une fois prête pour l'enlèvement ou en livraison.",
  },
  ORDER_ITEMS_LOCKED: {
    en: "Cannot modify order items after it has been marked ready for pickup or handed to delivery.",
    fr: "Impossible de modifier les articles une fois la commande prête pour l'enlèvement ou remise au livreur.",
  },
  ORDER_ITEM_NOT_IN_ORDER: {
    en: "This item is not in the order.",
    fr: "Cet article ne fait pas partie de la commande.",
  },
  NEW_QTY_REQUIRED: {
    en: "Give the new quantity to change it.",
    fr: "Indiquez la nouvelle quantité pour la modifier.",
  },
  QTY_ONLY_REDUCE: {
    en: 'You can only reduce the quantity of "{name}" (now {qty}).',
    fr: "Vous pouvez seulement réduire la quantité de « {name} » (actuellement {qty}).",
  },
  ORDER_NEEDS_ONE_ITEM: {
    en: "An order needs at least one item. To remove everything, cancel the order instead.",
    fr: "Une commande doit contenir au moins un article. Pour tout retirer, annulez plutôt la commande.",
  },
  MODIFICATIONS_REQUIRED: {
    en: "Add at least one change.",
    fr: "Ajoutez au moins une modification.",
  },
} satisfies LocalizedMessages;
