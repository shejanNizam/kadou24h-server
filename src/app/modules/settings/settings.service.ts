import { AuditLogServices } from "../audit_log/audit_log.service";
import { ISettings, ISettingsInitial } from "./settings.interface";
import { Settings } from "./settings.model";

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
    rides: s.rides,
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
