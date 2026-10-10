/**
 * Helpers shared by the delivery services (PINs).
 */
import bcrypt from "bcrypt";
import crypto from "crypto";
import { configs } from "../../config";

const PIN_FIELDS = ["pickupPin", "handoverPin", "pickupPinHash", "handoverPinHash"] as const;

export type PinField = (typeof PIN_FIELDS)[number];

/** Copy of a delivery without any PIN or PIN hash. */
const withoutPins = <T extends object>(delivery: T): Omit<T, PinField> => {
  const copy = { ...delivery };
  for (const field of PIN_FIELDS) Reflect.deleteProperty(copy, field);
  return copy;
};

/** Generates a random 4-digit PIN (crypto-secure) and its bcrypt hash. */
const generatePinPair = async (): Promise<{ pin: string; hash: string }> => {
  const pin = crypto.randomInt(1000, 10000).toString();
  const saltRounds = Number(configs.bcrypt_salt_round) || 10;
  const hash = await bcrypt.hash(pin, saltRounds);
  return { pin, hash };
};

export { PIN_FIELDS, withoutPins, generatePinPair };
