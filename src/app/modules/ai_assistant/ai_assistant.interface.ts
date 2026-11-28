import { Document, Types } from "mongoose";
import { AppMode } from "../user/user.interface";

export enum AssistantRole {
  user = "user",
  assistant = "assistant",
}

export interface IAssistantMessage {
  _id?: Types.ObjectId;
  role: AssistantRole;
  text: string;
  /** Assistant answers only: it suggested writing to the support team */
  needsHuman?: boolean;
  createdAt: Date;
}

export enum AssistantConversationStatus {
  /** The one the person is talking in */
  active = "active",
  /** Started again from scratch */
  closed = "closed",
  /** Sent to the support team as a ticket */
  handed_off = "handed_off",
}

/** A person's talk with the help assistant (one active at a time) */
export interface IAssistantConversationInitial {
  userId: Types.ObjectId;
  mode: AppMode;
  status: AssistantConversationStatus;
  messages: IAssistantMessage[];
  ticketId?: Types.ObjectId;
  lastMessageAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type IAssistantConversation = IAssistantConversationInitial & Document;

/** What the model answers (structured output) */
export interface IAssistantAnswer {
  reply: string;
  needsHuman: boolean;
}
