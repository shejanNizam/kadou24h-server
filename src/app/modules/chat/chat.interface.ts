import { Document, Types } from "mongoose";
import { AppMode } from "../user/user.interface";

export enum ConversationType {
  order = "order",
  buyer_seller = "buyer_seller",
  worker = "worker",
  job_application = "job_application",
}

export enum MessageType {
  text = "text",
  voice = "voice",
  image = "image",
  system = "system",
}

export enum ModerationStatus {
  clean = "clean",
  masked = "masked",
  blocked = "blocked",
}

export enum ModerationRule {
  phone = "phone",
  email = "email",
  url = "url",
  social = "social",
  off_platform_payment = "off_platform_payment",
}

export enum ModerationAction {
  warned = "warned",
  restricted = "restricted",
  suspended = "suspended",
  banned = "banned",
}

export interface IParticipant {
  userId: Types.ObjectId;
  mode: AppMode;
  unreadCount: number;
  lastReadAt?: Date;
}

export interface ILastMessage {
  text?: string;
  type: MessageType;
  senderId?: Types.ObjectId;
  at: Date;
}

export interface IConversationInitial {
  type: ConversationType;
  orderId?: Types.ObjectId;
  subOrderId?: Types.ObjectId;
  applicationId?: Types.ObjectId;
  workerProfileId?: Types.ObjectId;
  allowVoice: boolean;
  participants: IParticipant[];
  lastMessage?: ILastMessage;
  createdAt?: Date;
  updatedAt?: Date;
}

export type IConversation = IConversationInitial & Document;

export interface IMessageInitial {
  conversationId: Types.ObjectId;
  senderId?: Types.ObjectId | null;
  type: MessageType;
  text?: string;
  mediaUrl?: string;
  mediaDurationSec?: number;
  moderationStatus: ModerationStatus;
  moderationRules: string[];
  /** Blocked sender: the message is kept for the sender only (never sent to these users) */
  hiddenFor?: Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export type IMessage = IMessageInitial & Document;

export interface IModerationViolationInitial {
  userId: Types.ObjectId;
  conversationId?: Types.ObjectId;
  messageId?: Types.ObjectId;
  rule: string;
  snippet?: string;
  action: ModerationAction;
  actionBy: string; // 'system' or admin user ObjectId string
  createdAt?: Date;
  updatedAt?: Date;
}

export type IModerationViolation = IModerationViolationInitial & Document;
