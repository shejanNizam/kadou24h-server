const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const BOOKING = {
  /** The worker answers within 24 h (or before the date, if sooner), else the request expires */
  respondMs: 24 * HOUR,
  /** After "done", the customer confirms within 48 h, else it completes by itself */
  confirmMs: 48 * HOUR,
  /** Earliest / latest date a customer can book */
  minLeadMs: 30 * 60 * 1000,
  maxAheadMs: 60 * DAY,
  /** Anti-spam: open requests a customer can have at once (one per worker) */
  maxOpenRequests: 5,
  maxPhotos: 5,
  maxReviewPhotos: 4,
  /** Free visibility after the first approval, and for workers approved before subscriptions */
  trialDays: 30,
  /** "Your visibility ends in N days" reminder */
  listingReminderDays: 3,
  sweepEveryMs: 60 * 1000,
} as const;

/**
 * Cancellations after acceptance, counted over the rolling last 30 days (client, 2026-10-22).
 * Worker: 1st = warning, 2nd = less visible 15 days, 3rd+ = 7-day suspension then one booking
 * at a time for 30 days (the admin can soften it to 30 days less visible, or lift it).
 * Customer: 1st and 2nd = warning, 3rd+ = one booking at a time for 30 days.
 */
export const PENALTY = {
  windowMs: 30 * DAY,
  lessVisibleMs: 15 * DAY,
  suspensionMs: 7 * DAY,
  limitedMs: 30 * DAY,
  softenedLessVisibleMs: 30 * DAY,
  customerLimitFrom: 3,
} as const;

export const DAY_MS = DAY;
