import crypto from "node:crypto";
import httpStatus from "http-status";
import { Types } from "mongoose";
import { configs } from "../../config";
import { redisClient } from "../../config/redis.config";
import AppError from "../../errorHelpers/AppError";
import type { Locale } from "../../i18n/locale";
import { Order } from "../order/order.model";
import { SubOrder } from "../order/sub_order.model";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { SettingsServices } from "../settings/settings.service";
import { TicketType, TicketUrgency } from "../support_ticket/support_ticket.interface";
import { SupportTicketServices } from "../support_ticket/support_ticket.service";
import { AppMode } from "../user/user.interface";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { askModel, assistantConfigured } from "./ai_assistant.client";
import {
  AssistantConversationStatus,
  AssistantRole,
  type IAssistantConversation,
  type IAssistantMessage,
} from "./ai_assistant.interface";
import { ASSISTANT_MAX_STORED_MESSAGES, AssistantConversation } from "./ai_assistant.model";
import { buildSystemPrompt, type AssistantOrderLine, type AssistantSettings, type AssistantUserContext } from "./ai_assistant.prompt";

/** How many earlier messages the model sees (enough to follow, cheap to send) */
const HISTORY_FOR_MODEL = 12;
const RECENT_ORDERS = 5;

// ── Daily limits (Redis, UTC day = Guinea's day) ─────────────────────
const today = () => new Date().toISOString().slice(0, 10);
const userKey = (userId: string) => `assistant:u:${userId}:${today()}`;
const totalKey = () => `assistant:all:${today()}`;
const TWO_DAYS = 2 * 24 * 60 * 60;

const countUp = async (key: string) => {
  const n = await redisClient.incr(key);
  if (n === 1) await redisClient.expire(key, TWO_DAYS);
  return n;
};

/** Takes one question from today's allowance; throws when the person or the platform is at the limit */
async function reserveQuestion(userId: string, perUser: number, total: number): Promise<number> {
  const used = await countUp(userKey(userId));
  if (used > perUser) {
    await redisClient.decr(userKey(userId));
    throw new AppError(httpStatus.TOO_MANY_REQUESTS, "ASSISTANT_DAILY_LIMIT", { limit: perUser });
  }
  const all = await countUp(totalKey());
  if (all > total) {
    await Promise.all([redisClient.decr(userKey(userId)), redisClient.decr(totalKey())]);
    throw new AppError(httpStatus.TOO_MANY_REQUESTS, "ASSISTANT_BUSY");
  }
  return used;
}

/** A failed answer does not count */
const giveBackQuestion = (userId: string) => Promise.all([redisClient.decr(userKey(userId)), redisClient.decr(totalKey())]);

const usedToday = async (userId: string) => Number(await redisClient.get(userKey(userId))) || 0;

// ── Context ──────────────────────────────────────────────────────────
/** The person's own situation for the assistant: no name, phone, email or address */
async function loadUserContext(userId: string, mode: AppMode, locale: Locale): Promise<AssistantUserContext> {
  const context: AssistantUserContext = { mode, locale };

  if (mode === AppMode.vendor) {
    const store = await VendorProfile.findOne({ userId }).select("storeName approvalStatus isOpen").lean();
    if (store) context.store = { storeName: store.storeName, approvalStatus: store.approvalStatus, isOpen: store.isOpen };
    return context;
  }
  if (mode === AppMode.rider) {
    const rider = await RiderProfile.findOne({ userId }).select("approvalStatus partnerType isOnline").lean();
    if (rider) context.rider = { approvalStatus: rider.approvalStatus, partnerType: rider.partnerType, isOnline: rider.isOnline };
    return context;
  }

  const orders = await Order.find({ customerId: userId, hiddenByCustomerAt: { $exists: false } })
    .sort({ createdAt: -1 })
    .limit(RECENT_ORDERS)
    .select("orderNumber placedAt status paymentMethod paymentStatus total")
    .lean();
  const parts = orders.length
    ? await SubOrder.find({ orderId: { $in: orders.map((o) => o._id) } })
        .select("orderId status vendorId")
        .populate<{ vendorId: { storeName?: string } | null }>("vendorId", "storeName")
        .lean()
    : [];
  context.orders = orders.map(
    (o): AssistantOrderLine => ({
      orderNumber: o.orderNumber,
      placedAt: o.placedAt,
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      total: o.total,
      stores: parts
        .filter((p) => String(p.orderId) === String(o._id))
        .map((p) => ({ storeName: p.vendorId?.storeName ?? "?", status: p.status })),
    }),
  );
  return context;
}

// ── Conversation ─────────────────────────────────────────────────────
const toView = (c: IAssistantConversation | null) =>
  c && {
    _id: c._id,
    status: c.status,
    messages: c.messages.map((m: IAssistantMessage) => ({
      _id: m._id,
      role: m.role,
      text: m.text,
      needsHuman: m.needsHuman,
      createdAt: m.createdAt,
    })),
    lastMessageAt: c.lastMessageAt,
  };

const findActive = (userId: string) => AssistantConversation.findOne({ userId, status: AssistantConversationStatus.active });

const assistantSettings = async () => {
  const settings = await SettingsServices.getSettings();
  const a = settings.assistant;
  return {
    settings,
    available: Boolean(a?.enabled && assistantConfigured()),
    perUser: a?.dailyLimitPerUser ?? 20,
    total: a?.dailyLimitTotal ?? 2000,
  };
};

/** GET: the conversation going on (or none) and today's allowance */
const getCurrent = async (userId: string) => {
  const [{ available, perUser }, conversation, used] = await Promise.all([assistantSettings(), findActive(userId), usedToday(userId)]);
  return { available, conversation: toView(conversation), quota: { used, limit: perUser } };
};

/** The person asks a question; the assistant answers (both are kept) */
const sendMessage = async (userId: string, mode: AppMode, locale: Locale, text: string) => {
  const { settings, available, perUser, total } = await assistantSettings();
  if (!available) throw new AppError(httpStatus.SERVICE_UNAVAILABLE, "ASSISTANT_UNAVAILABLE");

  const used = await reserveQuestion(userId, perUser, total);
  try {
    const [existing, context] = await Promise.all([findActive(userId), loadUserContext(userId, mode, locale)]);
    const history = (existing?.messages ?? []).slice(-(HISTORY_FOR_MODEL - 1)).map((m) => ({ role: m.role, text: m.text }));
    history.push({ role: AssistantRole.user, text });

    const system = buildSystemPrompt(settings.toObject() as AssistantSettings, context);
    // Lets OpenAI spot abuse per person without learning who they are
    const safetyId = crypto.createHash("sha256").update(`kadou24h:${userId}`).digest("hex");
    const answer = await askModel(system, history, safetyId);
    if (!answer) throw new AppError(httpStatus.BAD_GATEWAY, "ASSISTANT_FAILED");

    const now = new Date();
    const pushed: IAssistantMessage[] = [
      { role: AssistantRole.user, text, createdAt: now },
      { role: AssistantRole.assistant, text: answer.reply.slice(0, 4000), needsHuman: answer.needsHuman, createdAt: new Date(now.getTime() + 1) },
    ];
    const conversation = await saveTurn(userId, mode, pushed);
    return { conversation: toView(conversation), quota: { used, limit: perUser } };
  } catch (error) {
    await giveBackQuestion(userId).catch(() => undefined);
    throw error;
  }
};

/** Adds the turn to the active conversation, opening one if needed (two at once still make one) */
async function saveTurn(userId: string, mode: AppMode, pushed: IAssistantMessage[]) {
  const update = {
    $push: { messages: { $each: pushed, $slice: -ASSISTANT_MAX_STORED_MESSAGES } },
    $set: { lastMessageAt: pushed[pushed.length - 1].createdAt, mode },
  };
  const filter = { userId: new Types.ObjectId(userId), status: AssistantConversationStatus.active };
  try {
    return await AssistantConversation.findOneAndUpdate(filter, update, { upsert: true, returnDocument: "after", setDefaultsOnInsert: true });
  } catch (error) {
    // Another request opened it a moment ago: add to that one
    if ((error as { code?: number }).code !== 11000) throw error;
    return AssistantConversation.findOneAndUpdate(filter, update, { returnDocument: "after" });
  }
}

/** "Start again": the current conversation is closed (kept for the team) */
const closeCurrent = async (userId: string) => {
  await AssistantConversation.updateOne(
    { userId, status: AssistantConversationStatus.active },
    { $set: { status: AssistantConversationStatus.closed } },
  );
};

/** Sends the conversation to the support team as a ticket */
const handOff = async (userId: string, mode: AppMode, note?: string) => {
  // Claimed first, so a double tap makes one ticket
  const conversation = await AssistantConversation.findOneAndUpdate(
    { userId, status: AssistantConversationStatus.active, "messages.role": AssistantRole.user },
    { $set: { status: AssistantConversationStatus.handed_off } },
    { returnDocument: "after" },
  );
  if (!conversation) throw new AppError(httpStatus.BAD_REQUEST, "ASSISTANT_NOTHING_TO_SEND");

  const questions = conversation.messages.filter((m) => m.role === AssistantRole.user);
  const lastQuestion = questions[questions.length - 1].text;
  try {
    // The person's own words; the team reads the whole conversation in the admin panel
    const ticket = await SupportTicketServices.createTicket(userId, mode, {
      type: TicketType.general,
      userMode: mode,
      urgency: TicketUrgency.medium,
      subject: questions[0].text.slice(0, 80),
      description: (note?.trim() || lastQuestion).slice(0, 2000),
      assistantConversationId: conversation._id as Types.ObjectId,
    });
    conversation.ticketId = ticket._id as Types.ObjectId;
    await conversation.save();
    return { ticketId: ticket._id, ticketNumber: ticket.ticketNumber };
  } catch (error) {
    await AssistantConversation.updateOne({ _id: conversation._id }, { $set: { status: AssistantConversationStatus.active } });
    throw error;
  }
};

// ── Admin ────────────────────────────────────────────────────────────
/** The team reads a conversation (from a ticket) */
const getConversationAdmin = async (id: string) => {
  const conversation = await AssistantConversation.findById(id).populate("userId", "name phone email avatar").lean();
  if (!conversation) throw new AppError(httpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND");
  return conversation;
};

/** Today's use (cost watch) */
const getUsageAdmin = async () => {
  const { settings, total } = await assistantSettings();
  const since = new Date(`${today()}T00:00:00.000Z`);
  const [questionsToday, conversationsToday, handOffsToday] = await Promise.all([
    redisClient.get(totalKey()),
    AssistantConversation.countDocuments({ lastMessageAt: { $gte: since } }),
    AssistantConversation.countDocuments({ status: AssistantConversationStatus.handed_off, updatedAt: { $gte: since } }),
  ]);
  return {
    configured: assistantConfigured(),
    enabled: Boolean(settings.assistant?.enabled),
    model: configs.OPENAI.model,
    questionsToday: Number(questionsToday) || 0,
    dailyLimitTotal: total,
    conversationsToday,
    handOffsToday,
  };
};

export const AssistantServices = {
  getCurrent,
  sendMessage,
  closeCurrent,
  handOff,
  getConversationAdmin,
  getUsageAdmin,
};
