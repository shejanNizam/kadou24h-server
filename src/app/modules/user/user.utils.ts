import crypto from "crypto";
import { IUser } from "./user.interface";
import { User } from "./user.model";

const REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion

/** Unique 8-character code for the "Share KADOU" link. */
export const generateReferralCode = async (): Promise<string> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = crypto.randomBytes(8);
    const code = Array.from(bytes, (b) => REFERRAL_ALPHABET[b % REFERRAL_ALPHABET.length]).join("");
    const taken = await User.exists({ referralCode: code });
    if (!taken) return code;
  }
  throw new Error("Could not generate a unique referral code");
};

/** Strips secrets before a user document leaves the API. */
export const toPublicUser = (user: IUser) => {
  const obj = user.toObject();
  delete obj.password;
  delete obj.deletedContact;
  delete obj.addresses; // served by GET /addresses
  delete obj.blockedUserIds;
  return obj;
};

export const isEmailIdentifier = (identifier: string) => identifier.includes("@");

export const normalizeIdentifier = (identifier: string) => {
  const value = identifier.trim();
  return isEmailIdentifier(value) ? value.toLowerCase() : value.replace(/[\s-]/g, "");
};

/** Query for an active (not deleted) user by phone or email. */
export const identifierFilter = (identifier: string) => {
  const value = normalizeIdentifier(identifier);
  return isEmailIdentifier(value)
    ? { email: value, isDeleted: false }
    : { phone: value, isDeleted: false };
};

// "+224620123456" -> "+224 ••• •• 56"
export const maskPhone = (phone?: string) =>
  phone ? `${phone.slice(0, 4)} ••• •• ${phone.slice(-2)}` : undefined;

// "diallo@gmail.com" -> "di•••@gmail.com"
export const maskEmail = (email?: string) => {
  if (!email) return undefined;
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}•••@${domain}`;
};
