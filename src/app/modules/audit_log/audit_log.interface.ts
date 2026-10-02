import { Document, Types } from "mongoose";

export interface IAuditLogInitial {
  actorId: Types.ObjectId;
  action: string; // dot-namespaced, e.g. "user.suspend", "settings.update"
  targetType: string; // e.g. "user", "settings", "withdrawal"
  targetId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
}

export type IAuditLog = IAuditLogInitial & Document;
