import { Types } from "mongoose";
import { emitToConversation, emitToUser } from "../../../socket/socket";
import AppError from "../../errorHelpers/AppError";
import { NotificationType } from "../notification/notification.interface";
import { NotificationServices } from "../notification/notification.service";
import { Settings } from "../settings/settings.model";
import { AppMode, UserStatus } from "../user/user.interface";
import { User } from "../user/user.model";
import {
  ConversationType,
  IConversation,
  IMessage,
  MessageType,
  ModerationAction,
  ModerationRule,
  ModerationStatus,
} from "./chat.interface";
import { Conversation } from "./conversation.model";
import { Message } from "./message.model";
import { assertReachable, resolveConversation, type StartConversationInput } from "./chat.start.service";
import { inspectContent } from "./moderation.util";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { ModerationViolation } from "./moderation_violation.model";
import { ChatBlockServices } from "./chat.block.service";

// Set when chat moderation suspends someone — lets an admin lift exactly that suspension
const CHAT_SUSPENSION_REASON =
  "Suspended for repeated off-platform contact sharing / circumvention violations.";

const SYSTEM_SAFETY_WARNING =
  "Notice: Pour votre sécurité, effectuez tous vos paiements via Kadou24h. Ne partagez jamais vos coordonnées bancaires ou numéros de téléphone en dehors de l'application.";

// Participants as the app may see them: never a phone or email (client rule —
// all contact goes through this chat). A store shows as the store.
const PARTICIPANT_FIELDS = "name avatar";

type LeanParticipant = { userId: { _id: Types.ObjectId; name?: string; avatar?: unknown } | Types.ObjectId; mode: string; unreadCount: number; lastReadAt?: Date };

/**
 * Adds `peer` (the other person: display name, avatar, mode) and `myUnread`
 * for the viewer. Store participants are shown with the store name and logo.
 */
const presentConversations = async <T extends { participants: LeanParticipant[] }>(
  conversations: T[],
  viewerId: string,
) => {
  const idOf = (p: LeanParticipant) => String((p.userId as { _id?: Types.ObjectId })._id ?? p.userId);
  const vendorUserIds = conversations.flatMap((c) =>
    c.participants.filter((p) => p.mode === AppMode.vendor && idOf(p) !== viewerId).map(idOf),
  );
  const stores = vendorUserIds.length
    ? await VendorProfile.find({ userId: { $in: vendorUserIds } }).select("userId storeName logo").lean()
    : [];
  const storeByUser = new Map(stores.map((v) => [String(v.userId), v]));
  // People the viewer blocked (only the viewer ever knows)
  const blocked = await ChatBlockServices.blockedAmong(
    viewerId,
    conversations.flatMap((c) => c.participants.filter((p) => idOf(p) !== viewerId).map(idOf)),
  );

  return conversations.map((c) => {
    const mine = c.participants.find((p) => idOf(p) === viewerId);
    const other = c.participants.find((p) => p !== mine) ?? mine;
    const user = (other?.userId ?? {}) as { _id?: Types.ObjectId; name?: string; avatar?: unknown };
    const store = other?.mode === AppMode.vendor ? storeByUser.get(idOf(other)) : undefined;
    return {
      ...c,
      myMode: mine?.mode,
      myUnread: mine?.unreadCount ?? 0,
      blockedByMe: other ? blocked.has(idOf(other)) : false,
      peer: {
        userId: other ? idOf(other) : undefined,
        mode: other?.mode,
        name: store?.storeName ?? user.name ?? "",
        avatar: store?.logo ?? user.avatar,
        ...(store && { vendorId: store._id }),
      },
    };
  });
};

const startOrGetConversation = async (userId: string, input: StartConversationInput) => {
  const resolved = await resolveConversation(userId, input);
  await assertReachable(resolved.other.userId);

  // Same subject + same two people in the same modes → the existing chat
  const existingQuery: Record<string, unknown> = {
    type: resolved.type,
    participants: { $all: [resolved.me, resolved.other].map((p) => ({ $elemMatch: { userId: p.userId, mode: p.mode } })) },
  };
  for (const [key, value] of Object.entries(resolved.context)) existingQuery[key] = value;

  let conversation = await Conversation.findOne(existingQuery).select("_id");
  if (!conversation) {
    conversation = await Conversation.create({
      type: resolved.type,
      ...resolved.context,
      allowVoice: resolved.allowVoice,
      participants: [
        { userId: resolved.me.userId, mode: resolved.me.mode, unreadCount: 0, lastReadAt: new Date() },
        { userId: resolved.other.userId, mode: resolved.other.mode, unreadCount: 0 },
      ],
      lastMessage: { text: SYSTEM_SAFETY_WARNING, type: MessageType.system, at: new Date() },
    });
    // Every chat opens with the safety notice
    await Message.create({
      conversationId: conversation._id,
      senderId: null,
      type: MessageType.system,
      text: SYSTEM_SAFETY_WARNING,
      moderationStatus: ModerationStatus.clean,
      moderationRules: [],
    });
  }
  return getConversationById(userId, String(conversation._id));
};

const getMyConversations = async (
  userId: string,
  mode: string,
  query: { page?: number; limit?: number },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = {
    participants: {
      $elemMatch: {
        userId: new Types.ObjectId(userId),
        mode,
      },
    },
  };

  const [data, total] = await Promise.all([
    Conversation.find(filter)
      .populate("participants.userId", PARTICIPANT_FIELDS)
      .populate("subOrderId", "subOrderNumber")
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Conversation.countDocuments(filter),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data: await presentConversations(data as unknown as (typeof data[number] & { participants: LeanParticipant[] })[], userId),
  };
};

/** Total unread messages in one mode — the Chat tab badge */
const getUnreadCount = async (userId: string, mode: string) => {
  const [row] = await Conversation.aggregate<{ unreadCount: number }>([
    { $match: { participants: { $elemMatch: { userId: new Types.ObjectId(userId), mode } } } },
    { $unwind: "$participants" },
    { $match: { "participants.userId": new Types.ObjectId(userId), "participants.mode": mode } },
    { $group: { _id: null, unreadCount: { $sum: "$participants.unreadCount" } } },
  ]);
  return { unreadCount: row?.unreadCount ?? 0 };
};

const getConversationById = async (userId: string, conversationId: string) => {
  if (!Types.ObjectId.isValid(conversationId)) throw new AppError(404, "Conversation not found");
  const conversation = await Conversation.findById(conversationId)
    .populate("participants.userId", PARTICIPANT_FIELDS)
    .populate("subOrderId", "subOrderNumber orderId status")
    .lean();

  if (!conversation) {
    throw new AppError(404, "Conversation not found");
  }

  const isParticipant = (conversation.participants as unknown as LeanParticipant[]).some(
    (p) => String((p.userId as { _id?: Types.ObjectId })._id ?? p.userId) === userId.toString(),
  );

  if (!isParticipant) {
    throw new AppError(403, "You are not a participant in this conversation");
  }

  const [presented] = await presentConversations([conversation as unknown as typeof conversation & { participants: LeanParticipant[] }], userId);
  return presented;
};

const getMessages = async (
  userId: string,
  conversationId: string,
  query: { page?: number; limit?: number },
) => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw new AppError(404, "Conversation not found");
  }

  const isParticipant = conversation.participants.some(
    (p) => p.userId.toString() === userId.toString(),
  );

  if (!isParticipant) {
    throw new AppError(403, "You are not a participant in this conversation");
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  const skip = (page - 1) * limit;

  // Messages from someone I blocked were never meant for me
  const filter = { conversationId: new Types.ObjectId(conversationId), hiddenFor: { $ne: new Types.ObjectId(userId) } };

  // Page 1 = the latest messages (a chat opens at the bottom); older pages on scroll-up.
  // Inside a page, oldest → newest.
  const [newestFirst, total] = await Promise.all([
    Message.find(filter)
      .populate("senderId", "name avatar")
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Message.countDocuments(filter),
  ]);
  const data = newestFirst.reverse();

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data,
  };
};

interface ISendMessagePayload {
  type: MessageType;
  text?: string;
  mediaUrl?: string;
  mediaDurationSec?: number;
}

const sendMessage = async (
  senderId: string,
  conversationId: string,
  payload: ISendMessagePayload,
): Promise<IMessage> => {
  // 1. Verify sender user & check moderation restrictions
  const sender = await User.findById(senderId);
  if (!sender || sender.isDeleted) {
    throw new AppError(404, "Sender user not found");
  }

  if (sender.status === UserStatus.suspended || sender.status === UserStatus.banned) {
    throw new AppError(403, "Your account is suspended. You cannot send messages.");
  }

  if (
    sender.moderation?.chatRestrictedUntil &&
    new Date(sender.moderation.chatRestrictedUntil) > new Date()
  ) {
    throw new AppError(
      403,
      `Your chat is temporarily restricted until ${new Date(
        sender.moderation.chatRestrictedUntil,
      ).toLocaleString()} due to policy violations.`,
    );
  }

  // 2. Fetch conversation
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw new AppError(404, "Conversation not found");
  }

  const isParticipant = conversation.participants.some(
    (p) => p.userId.toString() === senderId.toString(),
  );

  if (!isParticipant) {
    throw new AppError(403, "You are not a participant in this conversation");
  }

  // 3. Voice note policy check
  if (payload.type === MessageType.voice) {
    if (!conversation.allowVoice) {
      throw new AppError(
        400,
        "Voice notes are only permitted between customer and delivery partner.",
      );
    }
  }

  // 4. Content moderation & Anti-circumvention pipeline
  let textToSave = payload.text;
  let moderationStatus = ModerationStatus.clean;
  let moderationRules: string[] = [];

  if (payload.text) {
    const moderationResult = inspectContent(payload.text);
    if (!moderationResult.isClean) {
      moderationStatus = ModerationStatus.masked;
      moderationRules = moderationResult.rules;
      textToSave = moderationResult.maskedText;

      // Fetch moderation settings thresholds (defaults: 3 violations -> restrict, 5 -> suspend)
      const settings = await Settings.findOne().lean();
      const restrictAfter = settings?.moderation?.restrictAfter ?? 3;
      const suspendAfter = settings?.moderation?.suspendAfter ?? 5;
      const restrictHours = settings?.moderation?.restrictHours ?? 24;

      sender.moderation = sender.moderation || { violationCount: 0 };
      sender.moderation.violationCount = (sender.moderation.violationCount || 0) + 1;
      sender.moderation.lastViolationAt = new Date();

      let action: ModerationAction;

      if (sender.moderation.violationCount >= suspendAfter) {
        action = ModerationAction.suspended;
        sender.status = UserStatus.suspended;
        sender.statusReason =
          CHAT_SUSPENSION_REASON;

        await NotificationServices.createNotification({
          userId: sender._id,
          type: NotificationType.account_suspended,
          title: {
            fr: "Compte suspendu",
            en: "Account Suspended",
          },
          body: {
            fr: "Votre compte a été suspendu pour violations répétées des règles de communication Kadou24h.",
            en: "Your account has been suspended for repeated violations of Kadou24h communication policies.",
          },
        });
      } else if (sender.moderation.violationCount >= restrictAfter) {
        action = ModerationAction.restricted;
        sender.moderation.chatRestrictedUntil = new Date(
          Date.now() + restrictHours * 60 * 60 * 1000,
        );

        await NotificationServices.createNotification({
          userId: sender._id,
          type: NotificationType.moderation_warning,
          title: {
            fr: "Messagerie temporairement restreinte",
            en: "Chat Temporarily Restricted",
          },
          body: {
            fr: `Votre messagerie est restreinte pendant ${restrictHours} heures suite au partage de coordonnées personnelles.`,
            en: `Your messaging is restricted for ${restrictHours} hours due to sharing personal contact details.`,
          },
        });
      } else {
        action = ModerationAction.warned;

        await NotificationServices.createNotification({
          userId: sender._id,
          type: NotificationType.moderation_warning,
          title: {
            fr: "Avertissement de sécurité",
            en: "Safety Warning",
          },
          body: {
            fr: "Attention: Le partage de coordonnées directes ou de moyens de paiement hors plateforme est strictement interdit.",
            en: "Warning: Sharing direct contact info or off-platform payment details is strictly forbidden.",
          },
        });
      }

      await sender.save();

      // Record violation
      await ModerationViolation.create({
        userId: sender._id,
        conversationId: conversation._id,
        rule: (moderationRules[0] as ModerationRule) || ModerationRule.phone,
        snippet: moderationResult.violations.map((v) => v.matchedText).join(", "),
        action,
        actionBy: "system",
      });
    }
  }

  // 5. Save message — kept for the sender only when the recipient blocked them
  const hiddenFor = await ChatBlockServices.hiddenRecipients(conversation, senderId);
  const isHidden = (id: Types.ObjectId) => hiddenFor.some((h) => String(h) === String(id));
  const created = await Message.create({
    ...(hiddenFor.length && { hiddenFor }),
    conversationId: conversation._id,
    senderId: sender._id,
    type: payload.type,
    text: textToSave,
    mediaUrl: payload.mediaUrl,
    mediaDurationSec: payload.mediaDurationSec,
    moderationStatus,
    moderationRules,
  });
  // What the sender (and the sockets) see: never the hidden list
  const message = created.toObject() as unknown as IMessage;
  Reflect.deleteProperty(message, "hiddenFor");

  // 6. Update conversation lastMessage & participant unread counters
  let previewText = message.text;
  if (!previewText) {
    if (message.type === MessageType.voice) previewText = "Message vocal";
    else if (message.type === MessageType.image) previewText = "Photo";
    else previewText = "Nouveau message";
  }

  // A hidden message changes nothing the blocker can see (preview, unread)
  const visibleToOthers = conversation.participants.some((p) => p.userId.toString() !== senderId.toString() && !isHidden(p.userId));
  if (visibleToOthers) {
    conversation.lastMessage = {
      text: previewText,
      type: message.type,
      senderId: sender._id,
      at: message.createdAt || new Date(),
    };
  }

  conversation.participants.forEach((p) => {
    if (p.userId.toString() !== senderId.toString() && !isHidden(p.userId)) {
      p.unreadCount = (p.unreadCount || 0) + 1;
    }
  });

  await conversation.save();

  // 7. Emit real-time events via Socket.io (only to the sender when hidden)
  if (hiddenFor.length) emitToUser(senderId.toString(), "new_message", message);
  else emitToConversation(conversationId, "new_message", message);

  // Notify recipients via push/socket notification
  for (const p of conversation.participants) {
    if (p.userId.toString() !== senderId.toString() && !isHidden(p.userId)) {
      emitToUser(p.userId.toString(), "conversation_unread", {
        conversationId: conversation._id,
        unreadCount: p.unreadCount,
      });

      NotificationServices.createNotification({
        userId: p.userId,
        mode: p.mode,
        type: NotificationType.new_message,
        title: {
          fr: `Nouveau message de ${sender.name}`,
          en: `New message from ${sender.name}`,
        },
        body: {
          fr: previewText.slice(0, 100),
          en: previewText.slice(0, 100),
        },
        data: {
          conversationId: conversation._id.toString(),
          messageId: message._id.toString(),
        },
      }).catch(() => {
        // silent fail for async background notification
      });
    }
  }

  return message;
};

const markConversationAsRead = async (
  userId: string,
  userMode: string,
  conversationId: string,
): Promise<IConversation> => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw new AppError(404, "Conversation not found");
  }

  const participant = conversation.participants.find(
    (p) =>
      p.userId.toString() === userId.toString() &&
      (!userMode || p.mode === userMode),
  );

  if (participant) {
    participant.unreadCount = 0;
    participant.lastReadAt = new Date();
    await conversation.save();

    emitToConversation(conversationId, "message_read", {
      conversationId,
      userId,
      readAt: participant.lastReadAt,
    });
  }

  return conversation;
};

const getModerationViolationsAdmin = async (query: {
  rule?: string;
  action?: string;
  userId?: string;
  page?: number;
  limit?: number;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.rule) filter.rule = query.rule;
  if (query.action) filter.action = query.action;
  if (query.userId) {
    if (!Types.ObjectId.isValid(query.userId)) throw new AppError(400, "Invalid userId");
    filter.userId = new Types.ObjectId(query.userId);
  }

  const [data, total] = await Promise.all([
    ModerationViolation.find(filter)
      .populate("userId", "name phone email avatar moderation")
      .populate("conversationId", "type allowVoice")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ModerationViolation.countDocuments(filter),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data,
  };
};

const liftUserChatRestrictionAdmin = async (targetUserId: string) => {
  const user = await User.findById(targetUserId);
  if (!user) {
    throw new AppError(404, "User not found");
  }

  // Fresh start: otherwise the very next flagged message suspends them again
  user.moderation = { ...(user.moderation ?? {}), violationCount: 0, chatRestrictedUntil: undefined };

  // Only undo a suspension that chat moderation caused — not one an admin set for another reason
  if (user.status === UserStatus.suspended && user.statusReason?.startsWith(CHAT_SUSPENSION_REASON)) {
    user.status = UserStatus.active;
    user.statusReason = "Suspension lifted by administrator";
  }

  await user.save();
  return user;
};

export const ChatServices = {
  startOrGetConversation,
  getMyConversations,
  getUnreadCount,
  getConversationById,
  getMessages,
  sendMessage,
  markConversationAsRead,
  getModerationViolationsAdmin,
  liftUserChatRestrictionAdmin,
};
