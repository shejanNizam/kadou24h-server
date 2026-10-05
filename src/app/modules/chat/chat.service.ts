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
import { inspectContent } from "./moderation.util";
import { ModerationViolation } from "./moderation_violation.model";

const SYSTEM_SAFETY_WARNING =
  "Notice: Pour votre sécurité, effectuez tous vos paiements via Kadou24h. Ne partagez jamais vos coordonnées bancaires ou numéros de téléphone en dehors de l'application.";

interface IStartConversationPayload {
  recipientId: string;
  recipientMode: AppMode;
  myMode: AppMode;
  type: ConversationType;
  orderId?: string;
  subOrderId?: string;
  applicationId?: string;
  workerProfileId?: string;
}

const startOrGetConversation = async (
  userId: string,
  payload: IStartConversationPayload,
): Promise<IConversation> => {
  if (userId.toString() === payload.recipientId.toString()) {
    throw new AppError(400, "You cannot start a conversation with yourself");
  }

  const recipient = await User.findById(payload.recipientId);
  if (!recipient || recipient.isDeleted) {
    throw new AppError(404, "Recipient user not found");
  }

  // Check if conversation already exists with identical context & participants
  const existingQuery: Record<string, unknown> = {
    type: payload.type,
    "participants.userId": {
      $all: [new Types.ObjectId(userId), new Types.ObjectId(payload.recipientId)],
    },
  };

  if (payload.subOrderId) {
    existingQuery.subOrderId = new Types.ObjectId(payload.subOrderId);
  }
  if (payload.applicationId) {
    existingQuery.applicationId = new Types.ObjectId(payload.applicationId);
  }
  if (payload.orderId) {
    existingQuery.orderId = new Types.ObjectId(payload.orderId);
  }

  const existing = await Conversation.findOne(existingQuery).populate(
    "participants.userId",
    "name avatar phone roles lastActiveMode",
  );

  if (existing) {
    return existing;
  }

  // Voice note policy: allow_voice = true STRICTLY ONLY for customer <-> rider
  const isCustomerAndRider =
    (payload.myMode === AppMode.customer && payload.recipientMode === AppMode.rider) ||
    (payload.myMode === AppMode.rider && payload.recipientMode === AppMode.customer);

  const allowVoice = isCustomerAndRider;

  // Create new conversation
  const conversation = await Conversation.create({
    type: payload.type,
    orderId: payload.orderId ? new Types.ObjectId(payload.orderId) : undefined,
    subOrderId: payload.subOrderId ? new Types.ObjectId(payload.subOrderId) : undefined,
    applicationId: payload.applicationId
      ? new Types.ObjectId(payload.applicationId)
      : undefined,
    workerProfileId: payload.workerProfileId
      ? new Types.ObjectId(payload.workerProfileId)
      : undefined,
    allowVoice,
    participants: [
      {
        userId: new Types.ObjectId(userId),
        mode: payload.myMode,
        unreadCount: 0,
        lastReadAt: new Date(),
      },
      {
        userId: new Types.ObjectId(payload.recipientId),
        mode: payload.recipientMode,
        unreadCount: 0,
      },
    ],
    lastMessage: {
      text: SYSTEM_SAFETY_WARNING,
      type: MessageType.system,
      at: new Date(),
    },
  });

  // Automatically insert initial system safety warning message
  await Message.create({
    conversationId: conversation._id,
    senderId: null,
    type: MessageType.system,
    text: SYSTEM_SAFETY_WARNING,
    moderationStatus: ModerationStatus.clean,
    moderationRules: [],
  });

  const populated = await Conversation.findById(conversation._id).populate(
    "participants.userId",
    "name avatar phone roles lastActiveMode",
  );

  return populated || conversation;
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
      .populate("participants.userId", "name avatar phone roles lastActiveMode")
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
    data,
  };
};

const getConversationById = async (
  userId: string,
  conversationId: string,
): Promise<IConversation> => {
  const conversation = await Conversation.findById(conversationId).populate(
    "participants.userId",
    "name avatar phone roles lastActiveMode",
  );

  if (!conversation) {
    throw new AppError(404, "Conversation not found");
  }

  const isParticipant = conversation.participants.some(
    (p) => p.userId._id?.toString() === userId.toString() || p.userId.toString() === userId.toString(),
  );

  if (!isParticipant) {
    throw new AppError(403, "You are not a participant in this conversation");
  }

  return conversation;
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

  const filter = { conversationId: new Types.ObjectId(conversationId) };

  const [data, total] = await Promise.all([
    Message.find(filter)
      .populate("senderId", "name avatar")
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Message.countDocuments(filter),
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
          "Suspended for repeated off-platform contact sharing / circumvention violations.";

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

  // 5. Save message
  const message = await Message.create({
    conversationId: conversation._id,
    senderId: sender._id,
    type: payload.type,
    text: textToSave,
    mediaUrl: payload.mediaUrl,
    mediaDurationSec: payload.mediaDurationSec,
    moderationStatus,
    moderationRules,
  });

  // 6. Update conversation lastMessage & participant unread counters
  let previewText = message.text;
  if (!previewText) {
    if (message.type === MessageType.voice) previewText = "Message vocal";
    else if (message.type === MessageType.image) previewText = "Photo";
    else previewText = "Nouveau message";
  }

  conversation.lastMessage = {
    text: previewText,
    type: message.type,
    senderId: sender._id,
    at: message.createdAt || new Date(),
  };

  conversation.participants.forEach((p) => {
    if (p.userId.toString() !== senderId.toString()) {
      p.unreadCount = (p.unreadCount || 0) + 1;
    }
  });

  await conversation.save();

  // 7. Emit real-time events via Socket.io
  emitToConversation(conversationId, "new_message", message);

  // Notify recipients via push/socket notification
  for (const p of conversation.participants) {
    if (p.userId.toString() !== senderId.toString()) {
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
  if (query.userId) filter.userId = new Types.ObjectId(query.userId);

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

  user.moderation = user.moderation || { violationCount: 0 };
  user.moderation.chatRestrictedUntil = undefined;

  if (user.status === UserStatus.suspended) {
    user.status = UserStatus.active;
    user.statusReason = "Suspension lifted by administrator";
  }

  await user.save();
  return user;
};

export const ChatServices = {
  startOrGetConversation,
  getMyConversations,
  getConversationById,
  getMessages,
  sendMessage,
  markConversationAsRead,
  getModerationViolationsAdmin,
  liftUserChatRestrictionAdmin,
};
