/**
 * Blocking someone in the chat (client, 2026-10-22). The blocked person can still
 * "send", but the message is kept for them only (no unread, no notification, never
 * shown to the blocker) — they are not told. Exception: an order or a booking still in
 * progress between the two can always be discussed, so a delivery or a job never gets stuck.
 */
import httpStatus from "http-status";
import { model, Schema, Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { OPEN_STATUSES } from "../booking/booking.interface";
import { Booking } from "../booking/booking.model";
import { SubOrderStatus } from "../order/order.interface";
import { SubOrder } from "../order/sub_order.model";
import { User } from "../user/user.model";
import { ConversationType, IConversation } from "./chat.interface";
import { Conversation } from "./conversation.model";

interface IChatBlock {
  blockerId: Types.ObjectId;
  blockedId: Types.ObjectId;
  createdAt?: Date;
}

const chatBlockSchema = new Schema<IChatBlock>(
  {
    blockerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    blockedId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
chatBlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
chatBlockSchema.index({ blockedId: 1 });

export const ChatBlock = model<IChatBlock>("ChatBlock", chatBlockSchema);

const FINISHED_ORDER = [SubOrderStatus.delivered, SubOrderStatus.cancelled];

/** The other person in a conversation I'm part of */
const peerOf = async (userId: string, conversationId: string) => {
  const conversation = Types.ObjectId.isValid(conversationId) ? await Conversation.findById(conversationId).select("participants") : null;
  if (!conversation) throw new AppError(httpStatus.NOT_FOUND, "Conversation not found");
  if (!conversation.participants.some((p) => String(p.userId) === userId)) {
    throw new AppError(httpStatus.FORBIDDEN, "You are not a participant in this conversation");
  }
  const other = conversation.participants.find((p) => String(p.userId) !== userId);
  if (!other) throw new AppError(httpStatus.BAD_REQUEST, "There is nobody to block in this conversation");
  return other.userId;
};

const block = async (userId: string, conversationId: string) => {
  const other = await peerOf(userId, conversationId);
  await ChatBlock.updateOne({ blockerId: userId, blockedId: other }, { $setOnInsert: { blockerId: userId, blockedId: other } }, { upsert: true });
  return { blocked: true, userId: other };
};

const unblock = async (userId: string, conversationId: string) => {
  const other = await peerOf(userId, conversationId);
  await ChatBlock.deleteOne({ blockerId: userId, blockedId: other });
  return { blocked: false, userId: other };
};

const unblockUser = async (userId: string, otherId: string) => {
  if (!Types.ObjectId.isValid(otherId)) throw new AppError(httpStatus.NOT_FOUND, "User not found");
  await ChatBlock.deleteOne({ blockerId: userId, blockedId: otherId });
  return { blocked: false, userId: otherId };
};

/** People I blocked (name + avatar only) */
const listBlocked = async (userId: string) => {
  const rows = await ChatBlock.find({ blockerId: userId }).sort({ createdAt: -1 }).lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.blockedId) } }).select("name avatar").lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return rows.map((r) => ({ userId: r.blockedId, name: byId.get(String(r.blockedId))?.name ?? "", avatar: byId.get(String(r.blockedId))?.avatar, blockedAt: r.createdAt }));
};

/** Which of these people I blocked (for the conversation list / screen) */
const blockedAmong = async (viewerId: string, otherIds: string[]) => {
  if (!otherIds.length) return new Set<string>();
  const rows = await ChatBlock.find({ blockerId: viewerId, blockedId: { $in: otherIds } }).select("blockedId").lean();
  return new Set(rows.map((r) => String(r.blockedId)));
};

/** An order or booking between them is still going: messages always get through */
const inProgress = async (conversation: Pick<IConversation, "type" | "subOrderId">, a: Types.ObjectId, b: Types.ObjectId) => {
  if (conversation.type === ConversationType.order && conversation.subOrderId) {
    return Boolean(await SubOrder.exists({ _id: conversation.subOrderId, status: { $nin: FINISHED_ORDER } }));
  }
  if (conversation.type === ConversationType.worker) {
    return Boolean(
      await Booking.exists({
        status: { $in: OPEN_STATUSES },
        $or: [
          { customerId: a, workerId: b },
          { customerId: b, workerId: a },
        ],
      }),
    );
  }
  return false;
};

/** Recipients who blocked the sender (and whose chat with them isn't protected by an open order / booking) */
const hiddenRecipients = async (conversation: Pick<IConversation, "type" | "subOrderId" | "participants">, senderId: string) => {
  const others = conversation.participants.filter((p) => String(p.userId) !== senderId).map((p) => p.userId);
  if (!others.length) return [];
  const blockers = await ChatBlock.find({ blockerId: { $in: others }, blockedId: senderId }).select("blockerId").lean();
  if (!blockers.length) return [];
  const sender = new Types.ObjectId(senderId);
  const hidden: Types.ObjectId[] = [];
  for (const b of blockers) {
    if (!(await inProgress(conversation, b.blockerId, sender))) hidden.push(b.blockerId);
  }
  return hidden;
};

export const ChatBlockServices = {
  block,
  unblock,
  unblockUser,
  listBlocked,
  blockedAmong,
  hiddenRecipients,
};
