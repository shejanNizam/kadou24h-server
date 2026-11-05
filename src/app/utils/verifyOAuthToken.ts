import crypto from "crypto";
import httpStatus from "http-status";
import jwt, { JwtPayload } from "jsonwebtoken";
import { configs } from "../config/index";
import AppError from "../errorHelpers/AppError";

export type OAuthProvider = "google" | "apple";

export interface IOAuthProfile {
  provider: OAuthProvider;
  providerId: string; // `sub` claim — stable per user
  email?: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

const PROVIDERS = {
  google: {
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["accounts.google.com", "https://accounts.google.com"],
    audiences: () => configs.OAUTH.google_client_ids,
  },
  apple: {
    jwksUrl: "https://appleid.apple.com/auth/keys",
    issuers: ["https://appleid.apple.com"],
    audiences: () => configs.OAUTH.apple_client_ids,
  },
} as const;

const JWKS_TTL_MS = 60 * 60 * 1000;
interface Jwk {
  kid?: string;
  [key: string]: unknown;
}

const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

const getSigningKey = async (provider: OAuthProvider, kid: string, retry = true) => {
  const { jwksUrl } = PROVIDERS[provider];
  let cached = jwksCache.get(provider);

  if (!cached || Date.now() - cached.fetchedAt > JWKS_TTL_MS) {
    const res = await fetch(jwksUrl);
    if (!res.ok) {
      throw new AppError(httpStatus.BAD_GATEWAY, "OAUTH_UNREACHABLE", { provider });
    }
    const body = (await res.json()) as { keys: Jwk[] };
    cached = { keys: body.keys, fetchedAt: Date.now() };
    jwksCache.set(provider, cached);
  }

  const jwk = cached.keys.find((k) => k.kid === kid);
  if (!jwk) {
    // Keys rotate — refetch once before giving up
    if (retry) {
      jwksCache.delete(provider);
      return getSigningKey(provider, kid, false);
    }
    throw new AppError(httpStatus.UNAUTHORIZED, "OAUTH_TOKEN_INVALID");
  }

  return crypto.createPublicKey({ key: jwk, format: "jwk" } as Parameters<typeof crypto.createPublicKey>[0]);
};

/** Verifies a Google / Apple ID token sent by the mobile app's native SDK. */
export const verifyOAuthToken = async (
  provider: OAuthProvider,
  idToken: string,
): Promise<IOAuthProfile> => {
  const { issuers, audiences } = PROVIDERS[provider];
  const allowedAudiences = audiences();

  if (allowedAudiences.length === 0) {
    throw new AppError(httpStatus.SERVICE_UNAVAILABLE, "OAUTH_NOT_CONFIGURED", { provider });
  }

  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded.payload === "string" || !decoded.header.kid) {
    throw new AppError(httpStatus.UNAUTHORIZED, "OAUTH_TOKEN_INVALID");
  }

  const key = await getSigningKey(provider, decoded.header.kid);

  let payload: JwtPayload;
  try {
    payload = jwt.verify(idToken, key, {
      algorithms: ["RS256"],
      issuer: issuers as unknown as [string, ...string[]],
      audience: allowedAudiences as [string, ...string[]],
    }) as JwtPayload;
  } catch {
    throw new AppError(httpStatus.UNAUTHORIZED, "OAUTH_TOKEN_INVALID");
  }

  if (!payload.sub) {
    throw new AppError(httpStatus.UNAUTHORIZED, "OAUTH_TOKEN_INVALID");
  }

  // Apple sends email_verified as a string
  const emailVerified =
    payload.email_verified === true || payload.email_verified === "true";

  return {
    provider,
    providerId: payload.sub,
    email: typeof payload.email === "string" ? payload.email.toLowerCase() : undefined,
    emailVerified,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
};
