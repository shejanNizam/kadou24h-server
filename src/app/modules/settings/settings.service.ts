import { AuditLogServices } from "../audit_log/audit_log.service";
import { ISettings, ISettingsInitial } from "./settings.interface";
import { Settings } from "./settings.model";
import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { configs } from "../../config";
import { DeliveryRate } from "../delivery_rate/delivery_rate.model";
import { DeliveryRateType } from "../delivery_rate/delivery_rate.interface";

// Settings are read on almost every money calculation — cache briefly in memory.
const CACHE_TTL_MS = 30 * 1000;
let cache: { value: ISettings; at: number } | null = null;

/** Returns the singleton settings document, creating it with defaults on first use. */
const getSettings = async (): Promise<ISettings> => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const settings = await Settings.findOneAndUpdate(
    {},
    { $setOnInsert: { platformName: "Kadou" } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  cache = { value: settings, at: Date.now() };
  return settings;
};

/** Safe subset for the mobile app (fees shown at checkout, support contacts). */
const getPublicSettings = async () => {
  const s = await getSettings();
  return {
    platformName: s.platformName,
    supportEmail: s.supportEmail,
    contactNumber: s.contactNumber,
    whatsappSupportNumber: s.whatsappSupportNumber,
    defaultCurrency: s.defaultCurrency,
    logo: s.logo,
    commission: s.commission,
    platformFee: s.platformFee,
    taxRate: s.taxRate,
    withdrawalFees: s.withdrawalFees,
    pricing: s.pricing,
    orders: s.orders,
    // The app keeps "another city" addresses near the arrival station
    intercity: s.intercity,
    rides: s.rides,
    // The app tells people how long their messages are kept
    chat: s.chat,
    // The help assistant is offered only when the team switched it on and a key is set
    assistant: {
      available: Boolean(s.assistant?.enabled && configs.OPENAI.api_key),
      dailyLimitPerUser: s.assistant?.dailyLimitPerUser ?? 20,
    },
  };
};

// Flattens nested objects to dot paths so a partial update of e.g.
// `commission.rate` does not wipe `commission.min`.
const toDotPaths = (obj: Record<string, unknown>, prefix = ""): Record<string, unknown> =>
  Object.entries(obj).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const isPlainObject =
      value !== null && typeof value === "object" && !Array.isArray(value) && key !== "logo";
    return isPlainObject
      ? { ...acc, ...toDotPaths(value as Record<string, unknown>, path) }
      : { ...acc, [path]: value };
  }, {});

const updateSettings = async (
  payload: Partial<ISettingsInitial>,
  actorId: string,
) => {
  const before = (await getSettings()).toObject();

  // The two motos are paid from each route fare: a route must still leave something for the bus
  if (payload.intercity?.firstMileFee !== undefined || payload.intercity?.lastMileFee !== undefined) {
    const motos =
      (payload.intercity.firstMileFee ?? before.intercity?.firstMileFee ?? 0) + (payload.intercity.lastMileFee ?? before.intercity?.lastMileFee ?? 0);
    const cheapest = await DeliveryRate.findOne({ type: DeliveryRateType.intercity, isActive: true, fee: { $lte: motos } })
      .sort({ fee: 1 })
      .select("fee");
    if (cheapest) {
      throw new AppError(httpStatus.BAD_REQUEST, "INTERCITY_MOTOS_ABOVE_FARE", { fare: cheapest.fee ?? 0, motos });
    }
  }

  const updated = await Settings.findOneAndUpdate(
    {},
    { $set: { ...toDotPaths(payload as Record<string, unknown>), updatedBy: actorId } },
    { upsert: true, returnDocument: "after", runValidators: true },
  );

  cache = null;

  await AuditLogServices.record({
    actorId,
    action: "settings.update",
    targetType: "settings",
    targetId: String(updated._id),
    before,
    after: payload as Record<string, unknown>,
  });

  return updated;
};

export const SettingsServices = {
  getSettings,
  getPublicSettings,
  updateSettings,
};
