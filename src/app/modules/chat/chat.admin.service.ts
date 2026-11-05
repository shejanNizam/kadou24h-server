/**
 * The team opens a flagged or reported message in its conversation (client, 2026-10-26):
 * the message itself (text, photo or voice) with a few messages before and after, who
 * the two people are, and what moderation caught. Reading a private chat is recorded
 * in the audit log.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import type { ErrorCode } from "../../i18n/errors";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { ReportTargetType } from "../report/report.interface";
import { Report } from "../report/report.model";
import { Conversation } from "./conversation.model";
import { Message } from "./message.model";
import { ModerationViolation } from "./moderation_violation.model";
import { ModerationStatus } from "./chat.interface";

const DEFAULT_AROUND = 5;
const MAX_AROUND = 20;

const oid = (id: string, notFound: ErrorCode) => {
  if (!Types.ObjectId.isValid(id)) throw new AppError(httpStatus.NOT_FOUND, notFound);
  return new Types.ObjectId(id);
};

interface PopulatedUser { _id: Types.ObjectId; name?: string; phone?: string; avatar?: unknown; status?: string; moderation?: { violationCount?: number } }

/** The conversation around one message: `around` messages before and after it */
const contextAround = async (adminId: string, focus: { conversationId: Types.ObjectId; messageId?: Types.ObjectId; at: Date }, around: number) => {
  const conversation = await Conversation.findById(focus.conversationId)
    .populate("participants.userId", "name phone avatar status moderation.violationCount")
    .populate("subOrderId", "subOrderNumber")
    .lean();
  if (!conversation) throw new AppError(httpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND");

  const fields = "senderId type text mediaUrl mediaDurationSec moderationStatus moderationRules createdAt +hiddenFor";
  const target = focus.messageId ? await Message.findOne({ _id: focus.messageId, conversationId: conversation._id }).select(fields).lean() : null;
  const pivot = target?.createdAt ?? focus.at;
  const exclude = target ? { _id: { $ne: target._id } } : {};
  const [before, after] = await Promise.all([
    Message.find({ conversationId: conversation._id, createdAt: { $lte: pivot }, ...exclude }).select(fields).sort({ createdAt: -1 }).limit(around + 1).lean(),
    Message.find({ conversationId: conversation._id, createdAt: { $gt: pivot }, ...exclude }).select(fields).sort({ createdAt: 1 }).limit(around + 1).lean(),
  ]);
  const messages = [...before.slice(0, around).reverse(), ...(target ? [target] : []), ...after.slice(0, around)];

  const ids = messages.map((m) => m._id);
  const [violations, reports] = await Promise.all([
    ModerationViolation.find({ messageId: { $in: ids } }).select("messageId rule snippet action").lean(),
    Report.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { targetType: ReportTargetType.message, targetId: { $in: ids } } },
      { $group: { _id: "$targetId", count: { $sum: 1 } } },
    ]),
  ]);
  const violationOf = new Map(violations.map((v) => [String(v.messageId), { rule: v.rule, snippet: v.snippet, action: v.action }]));
  const reportsOf = new Map(reports.map((r) => [String(r._id), r.count]));

  await AuditLogServices.record({
    actorId: adminId,
    action: "chat.view_context",
    targetType: "conversation",
    targetId: String(conversation._id),
    after: { messageId: focus.messageId ? String(focus.messageId) : null, shown: messages.length },
  });

  const subOrder = conversation.subOrderId as unknown as { subOrderNumber?: string } | undefined;
  return {
    conversation: {
      _id: conversation._id,
      type: conversation.type,
      subOrderNumber: subOrder?.subOrderNumber,
      createdAt: conversation.createdAt,
      participants: conversation.participants.map((p) => {
        const user = p.userId as unknown as PopulatedUser;
        return {
          userId: user?._id ?? p.userId,
          name: user?.name ?? "",
          phone: user?.phone,
          avatar: user?.avatar,
          status: user?.status,
          violationCount: user?.moderation?.violationCount ?? 0,
          mode: p.mode,
        };
      }),
    },
    focusId: target?._id ?? null,
    messages: messages.map((m) => {
      const { hiddenFor, ...rest } = m as typeof m & { hiddenFor?: Types.ObjectId[] };
      return {
        ...rest,
        // Kept for the sender only: the other person had blocked them
        hiddenFromRecipient: Boolean(hiddenFor?.length),
        violation: violationOf.get(String(m._id)),
        reportCount: reportsOf.get(String(m._id)) ?? 0,
      };
    }),
    hasMoreBefore: before.length > around,
    hasMoreAfter: after.length > around,
  };
};

const clampAround = (value: unknown) => Math.min(MAX_AROUND, Math.max(1, Math.floor(Number(value)) || DEFAULT_AROUND));

/** From a report (or any message id) */
const getMessageContext = async (adminId: string, messageId: string, around?: unknown) => {
  const message = await Message.findById(oid(messageId, "MESSAGE_NOT_FOUND")).select("conversationId createdAt").lean();
  if (!message) throw new AppError(httpStatus.NOT_FOUND, "MESSAGE_NOT_FOUND");
  return contextAround(adminId, { conversationId: message.conversationId, messageId: message._id, at: message.createdAt! }, clampAround(around));
};

/** From an automatic moderation violation (older ones have no message id: found by time) */
const getViolationContext = async (adminId: string, violationId: string, around?: unknown) => {
  const violation = await ModerationViolation.findById(oid(violationId, "VIOLATION_NOT_FOUND")).lean();
  if (!violation?.conversationId) throw new AppError(httpStatus.NOT_FOUND, "VIOLATION_NOT_FOUND");
  const at = violation.createdAt ?? new Date();
  let messageId = violation.messageId;
  if (!messageId) {
    const guess = await Message.findOne({
      conversationId: violation.conversationId,
      senderId: violation.userId,
      moderationStatus: ModerationStatus.masked,
      createdAt: { $gte: new Date(at.getTime() - 60_000), $lte: new Date(at.getTime() + 60_000) },
    })
      .sort({ createdAt: 1 })
      .select("_id")
      .lean();
    messageId = guess?._id;
  }
  return contextAround(adminId, { conversationId: violation.conversationId, messageId, at }, clampAround(around));
};

export const ChatAdminServices = { getMessageContext, getViolationContext };
