import { App, cert, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { Types } from "mongoose";
import { configs } from "../config/index";
import { DeviceToken } from "../modules/device_token/device_token.model";
import { logger } from "./logger";

interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// FCM error codes meaning the token will never work again
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

let firebaseApp: App | null | undefined;

/** Lazily initialises Firebase. Returns null when push is not configured. */
const getFirebaseApp = (): App | null => {
  if (firebaseApp !== undefined) return firebaseApp;

  const encoded = configs.firebase_service_account_base64;
  if (!encoded) {
    logger.warn("Push notifications disabled: FIREBASE_SERVICE_ACCOUNT_BASE64 is not set");
    firebaseApp = null;
    return null;
  }

  try {
    const serviceAccount = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    firebaseApp = initializeApp({ credential: cert(serviceAccount) }, "kadou24h-push");
  } catch (error) {
    logger.error("Push notifications disabled: invalid Firebase service account", {
      error: error instanceof Error ? error.message : error,
    });
    firebaseApp = null;
  }
  return firebaseApp;
};

/**
 * Sends a push notification to every registered device of a user (FCM: Android,
 * iOS and web). Never throws — push is best-effort; the in-app notification is
 * the source of truth. Dead tokens are removed.
 */
export const sendPushToUser = async (userId: string | Types.ObjectId, message: PushMessage) => {
  const app = getFirebaseApp();
  if (!app) return { sent: 0, failed: 0 };

  try {
    const devices = await DeviceToken.find({ userId }).select("token").lean();
    const tokens = devices.map((d) => d.token);
    if (tokens.length === 0) return { sent: 0, failed: 0 };

    // FCM data values must be strings
    const data = Object.fromEntries(
      Object.entries(message.data ?? {}).map(([key, value]) => [
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      ]),
    );

    const result = await getMessaging(app).sendEachForMulticast({
      tokens,
      notification: { title: message.title, body: message.body },
      data,
      android: { priority: "high" },
      apns: { payload: { aps: { sound: "default" } } },
    });

    const deadTokens = result.responses
      .map((response, i) =>
        !response.success && DEAD_TOKEN_CODES.has(response.error?.code ?? "") ? tokens[i] : null,
      )
      .filter((t): t is string => t !== null);
    if (deadTokens.length) await DeviceToken.deleteMany({ token: { $in: deadTokens } });

    return { sent: result.successCount, failed: result.failureCount };
  } catch (error) {
    logger.error("Push notification failed", {
      userId: String(userId),
      error: error instanceof Error ? error.message : error,
    });
    return { sent: 0, failed: 0 };
  }
};
