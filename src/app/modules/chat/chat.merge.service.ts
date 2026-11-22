/**
 * One chat per customer and store (client, 2026-11-22: "TechHub Kaloum appears 5 times").
 * Customer ↔ store chats that used to be opened per order are merged into that pair's store
 * chat; each message keeps the order it was about. Runs at start-up and does nothing once
 * everything is merged. Rider chats stay per delivery.
 */
import { Types } from "mongoose";
import { logger } from "../../utils/logger";
import { Notification } from "../notification/notification.model";
import { SubOrder } from "../order/sub_order.model";
import { Report } from "../report/report.model";
import { AppMode } from "../user/user.interface";
import { ConversationType, IParticipant, MessageType, ModerationStatus } from "./chat.interface";
import { SYSTEM_SAFETY_WARNING } from "./chat.service";
import { Conversation } from "./conversation.model";
import { Message } from "./message.model";
import { ModerationViolation } from "./moderation_violation.model";

const later = (a?: Date, b?: Date) => (!a ? b : !b ? a : a > b ? a : b);
const sameParty = (a: IParticipant, b: IParticipant) => String(a.userId) === String(b.userId) && a.mode === b.mode;

/** The store chat of this customer and store, created when they never had one */
const storeChatFor = async (customer: IParticipant, seller: IParticipant, since: Date) => {
  const existing = await Conversation.findOne({
    type: ConversationType.buyer_seller,
    participants: { $all: [customer, seller].map((p) => ({ $elemMatch: { userId: p.userId, mode: p.mode } })) },
  });
  if (existing) return existing;
  const created = await Conversation.create({
    type: ConversationType.buyer_seller,
    allowVoice: true,
    participants: [customer, seller].map((p) => ({ userId: p.userId, mode: p.mode, unreadCount: 0, lastReadAt: p.lastReadAt })),
    lastMessage: { text: SYSTEM_SAFETY_WARNING, type: MessageType.system, at: since },
  });
  // Every chat opens with the safety notice, dated like the oldest chat it replaces
  await new Message({
    conversationId: created._id,
    senderId: null,
    type: MessageType.system,
    text: SYSTEM_SAFETY_WARNING,
    moderationStatus: ModerationStatus.clean,
    moderationRules: [],
    createdAt: since,
    updatedAt: since,
  }).save({ timestamps: false });
  return created;
};

const mergeOne = async (sourceId: Types.ObjectId) => {
  const source = await Conversation.findById(sourceId).lean();
  if (!source) return;
  const customer = source.participants.find((p) => p.mode === AppMode.customer);
  const seller = source.participants.find((p) => p.mode === AppMode.vendor);
  if (!customer || !seller) return;
  const subOrder = source.subOrderId ? await SubOrder.findById(source.subOrderId).select("subOrderNumber").lean() : null;
  const tag = subOrder ? { subOrderId: subOrder._id, subOrderNumber: subOrder.subOrderNumber } : {};
  const target = await storeChatFor(customer, seller, source.createdAt ?? new Date());

  // Messages move with their order; the per-order safety notices go (the store chat has one)
  await Message.deleteMany({ conversationId: source._id, type: MessageType.system });
  await Message.updateMany({ conversationId: source._id }, { $set: { conversationId: target._id, ...tag } }, { timestamps: false });

  for (const p of target.participants) {
    const old = source.participants.find((s) => sameParty(s, p));
    if (!old) continue;
    p.unreadCount = (p.unreadCount ?? 0) + (old.unreadCount ?? 0);
    p.lastReadAt = later(p.lastReadAt, old.lastReadAt);
  }
  const last = source.lastMessage;
  if (last && last.type !== MessageType.system && (!target.lastMessage || target.lastMessage.type === MessageType.system || last.at > target.lastMessage.at)) {
    target.lastMessage = { ...last, ...(subOrder && { subOrderNumber: subOrder.subOrderNumber }) };
  }
  target.set("updatedAt", later(target.updatedAt, source.updatedAt));
  await target.save({ timestamps: false });

  // Flags, reports and old notifications now open the store chat
  await Promise.all([
    ModerationViolation.updateMany({ conversationId: source._id }, { $set: { conversationId: target._id } }),
    Report.updateMany({ conversationId: source._id }, { $set: { conversationId: target._id } }),
    Notification.updateMany({ "data.conversationId": String(source._id) }, { $set: { "data.conversationId": String(target._id) } }),
  ]);
  await Conversation.deleteOne({ _id: source._id });
};

/** Returns how many per-order store chats were merged */
const mergeStoreChats = async () => {
  const sources = await Conversation.find({ type: ConversationType.order, "participants.mode": { $all: [AppMode.customer, AppMode.vendor] } })
    .select("_id")
    .sort({ createdAt: 1 })
    .lean();
  let merged = 0;
  for (const { _id } of sources) {
    try {
      await mergeOne(_id as Types.ObjectId);
      merged += 1;
    } catch (error) {
      logger.error("Store chat merge failed", { conversationId: String(_id), error: error instanceof Error ? error.message : error });
    }
  }
  return merged;
};

export const ChatMergeServices = { mergeStoreChats };
