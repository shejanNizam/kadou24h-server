import { authErrors } from "./auth";
import { catalogErrors } from "./catalog";
import { chatErrors } from "./chat";
import { commonErrors } from "./common";
import { deliveryErrors } from "./delivery";
import { orderErrors } from "./orders";
import { partnerErrors } from "./partners";
import { paymentErrors } from "./payment";
import { serviceErrors } from "./services";
import { validationErrors } from "./validation";
import { walletErrors } from "./wallet";

/**
 * Every error the API can answer with, by stable code. The code is the contract
 * with the clients (dashboard, app): never rename or reuse one; add a new code
 * when the meaning changes. Texts may be reworded freely.
 *
 * One file per area keeps the catalog readable; add a new part to this list.
 */
export const errorCatalogParts = [
  commonErrors,
  validationErrors,
  authErrors,
  orderErrors,
  paymentErrors,
  deliveryErrors,
  walletErrors,
  catalogErrors,
  partnerErrors,
  serviceErrors,
  chatErrors,
] as const;

type MergeParts<T extends readonly object[]> = T extends readonly [infer Head, ...infer Rest extends readonly object[]]
  ? Head & MergeParts<Rest>
  : unknown;

/** All parts in one lookup. A code defined twice is caught by the catalog test. */
export const errorCatalog = Object.freeze(Object.assign({}, ...errorCatalogParts)) as MergeParts<typeof errorCatalogParts>;

export type ErrorCode = keyof typeof errorCatalog;

export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(errorCatalog, value);
