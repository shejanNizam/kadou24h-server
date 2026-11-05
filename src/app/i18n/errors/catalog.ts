import type { LocalizedMessages } from "./types";

/** The shop: products, categories, the cart, favourites, promo codes, order reviews and ads. */
export const catalogErrors = {
  // Products
  PRODUCT_NOT_FOR_SALE: {
    en: "This product is not approved for sale.",
    fr: "Ce produit n'est pas autorisé à la vente.",
  },
  PRODUCT_OUT_OF_STOCK: {
    en: "This product is currently out of stock.",
    fr: "Ce produit est actuellement en rupture de stock.",
  },
  PRODUCT_NOT_YOURS: {
    en: "You can only change products of your own store.",
    fr: "Vous ne pouvez modifier que les produits de votre boutique.",
  },
  PLATFORM_STORE_MISSING: {
    en: "No vendorId provided and no platform store exists. Please specify vendorId.",
    fr: "Aucun vendorId fourni et aucune boutique de la plateforme n'existe. Indiquez un vendorId.",
  },
  STORE_NOT_APPROVED_TO_PUBLISH: {
    en: "Your store must be approved before you can publish products.",
    fr: "Votre boutique doit être approuvée avant de pouvoir publier des produits.",
  },

  // Categories
  CATEGORY_NOT_FOUND: {
    en: "Category not found.",
    fr: "Catégorie introuvable.",
  },
  CATEGORY_REQUIRED: {
    en: "Choose a valid, active category.",
    fr: "Choisissez une catégorie valide et active.",
  },
  CATEGORY_INVALID: {
    en: "Invalid or inactive {type, select, product {product} business {store} service {service} job {job} other {}} category.",
    fr: "Catégorie {type, select, product {de produit} business {de boutique} service {de service} job {d'emploi} other {}} invalide ou inactive.",
  },
  CATEGORY_TYPE_INVALID: {
    en: "The type must be product, business, service or job.",
    fr: "Le type doit être product, business, service ou job.",
  },
  SUBCATEGORY_MISMATCH: {
    en: "The subcategory must belong to the selected category and be active.",
    fr: "La sous-catégorie doit appartenir à la catégorie choisie et être active.",
  },
  PARENT_CATEGORY_NOT_FOUND: {
    en: "Parent category not found.",
    fr: "Catégorie parente introuvable.",
  },
  SUBCATEGORY_TYPE_MISMATCH: {
    en: "A subcategory must have the same type as its parent.",
    fr: "Une sous-catégorie doit avoir le même type que sa catégorie parente.",
  },
  CATEGORY_TOO_DEEP: {
    en: "Only two levels are allowed (category → subcategory).",
    fr: "Seuls deux niveaux sont permis (catégorie → sous-catégorie).",
  },
  CATEGORY_HAS_CHILDREN: {
    en: "This category has subcategories. Delete them first, or deactivate it.",
    fr: "Cette catégorie a des sous-catégories. Supprimez-les d'abord, ou désactivez-la.",
  },
  CATEGORY_IN_USE: {
    en: "This category is in use ({products, plural, one {# product} other {# products}}, {stores, plural, one {# store} other {# stores}}, {jobs, plural, one {# job} other {# jobs}}, {workers, plural, one {# worker profile} other {# worker profiles}}). Deactivate it instead: it disappears from the app but the data stays valid.",
    fr: "Cette catégorie est utilisée ({products, plural, one {# produit} other {# produits}}, {stores, plural, one {# boutique} other {# boutiques}}, {jobs, plural, one {# offre d'emploi} other {# offres d'emploi}}, {workers, plural, one {# profil de travailleur} other {# profils de travailleur}}). Désactivez-la plutôt : elle disparaît de l'application mais les données restent valides.",
  },

  // Cart and favourites
  CART_NOT_FOUND: {
    en: "Cart not found.",
    fr: "Panier introuvable.",
  },
  CART_ITEM_NOT_FOUND: {
    en: "This item is not in your cart.",
    fr: "Cet article n'est pas dans votre panier.",
  },
  CART_ADD_OVER_STOCK: {
    en: "Cannot add {qty} more. Only {available, plural, one {# item} other {# items}} available in stock.",
    fr: "Impossible d'en ajouter {qty} de plus. {available, plural, one {Seul # article est disponible} other {Seuls # articles sont disponibles}} en stock.",
  },
  STOCK_ONLY: {
    en: "Only {available, plural, one {# item} other {# items}} available in stock.",
    fr: "{available, plural, one {Seul # article est disponible} other {Seuls # articles sont disponibles}} en stock.",
  },

  // Promo codes
  COUPON_INVALID: {
    en: "This promo code is not valid.",
    fr: "Ce code promo n'est pas valide.",
  },
  COUPON_NOT_YET: {
    en: "This promo code is not valid yet.",
    fr: "Ce code promo n'est pas encore valable.",
  },
  COUPON_EXPIRED: {
    en: "This promo code has expired.",
    fr: "Ce code promo a expiré.",
  },
  COUPON_FULLY_USED: {
    en: "This promo code has been fully used.",
    fr: "Ce code promo a déjà été utilisé par trop de clients.",
  },
  COUPON_JUST_FULLY_USED: {
    en: "This promo code has just been fully used.",
    fr: "Ce code promo vient d'atteindre sa limite d'utilisation.",
  },
  COUPON_ALREADY_USED: {
    en: "You have already used this promo code.",
    fr: "Vous avez déjà utilisé ce code promo.",
  },
  COUPON_MIN_ORDER: {
    en: "This promo code needs a minimum order of {minOrder, number} GNF.",
    fr: "Ce code demande une commande d'au moins {minOrder, number} GNF (produits).",
  },
  COUPON_NOT_FOUND: {
    en: "Promo code not found.",
    fr: "Code promo introuvable.",
  },
  COUPON_CODE_TAKEN: {
    en: "This code already exists.",
    fr: "Ce code existe déjà.",
  },
  COUPON_PERCENT_MAX: {
    en: "A percentage can't be more than 100.",
    fr: "Un pourcentage ne peut pas dépasser 100.",
  },
  COUPON_LOCKED: {
    en: "This code was already used: its code, type and value can't change. Create a new code instead.",
    fr: "Ce code a déjà été utilisé : son code, son type et sa valeur ne peuvent plus changer. Créez plutôt un nouveau code.",
  },
  COUPON_CODE_FORMAT: {
    en: "Letters, numbers, - and _ only.",
    fr: "Lettres, chiffres, - et _ uniquement.",
  },

  // Reviews of an order
  REVIEW_NOT_FOUND: {
    en: "Review not found.",
    fr: "Avis introuvable.",
  },
  REVIEW_NOT_YOUR_ORDER: {
    en: "You can only review orders that you placed.",
    fr: "Vous ne pouvez donner votre avis que sur vos propres commandes.",
  },
  REVIEW_NOT_DELIVERED: {
    en: "You can only review delivered orders.",
    fr: "Vous ne pouvez donner votre avis que sur une commande livrée.",
  },
  ORDER_ALREADY_REVIEWED: {
    en: "You have already reviewed this order.",
    fr: "Vous avez déjà donné votre avis sur cette commande.",
  },
  RATING_RANGE: {
    en: "The rating must be between 1 and 5.",
    fr: "La note doit être comprise entre 1 et 5.",
  },

  // Products: prices
  DISCOUNT_PRICE_TOO_HIGH: {
    en: "The discount price must be less than the regular price.",
    fr: "Le prix réduit doit être inférieur au prix normal.",
  },

  // Advertisements
  AD_NOT_FOUND: {
    en: "Advertisement not found.",
    fr: "Publicité introuvable.",
  },
  IMAGES_REQUIRED: {
    en: "Add at least one image.",
    fr: "Ajoutez au moins une image.",
  },
} satisfies LocalizedMessages;
