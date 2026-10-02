import { Types } from "mongoose";
import { logger } from "../../utils/logger";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { IAuditLogInitial } from "./audit_log.interface";
import { AuditLog } from "./audit_log.model";

type RecordPayload = Omit<IAuditLogInitial, "actorId"> & { actorId: string | Types.ObjectId };

/**
 * Records an admin / money action. Never throws — an audit failure must not
 * roll back the action itself, but it is logged loudly.
 */
const record = async (payload: RecordPayload) => {
  try {
    await AuditLog.create(payload);
  } catch (error) {
    logger.error("Failed to write audit log", { error, action: payload.action });
  }
};

const getAuditLogs = async (query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder(AuditLog.find(), query);

  const logs = await queryBuilder
    .search(["action", "targetType", "targetId"])
    .filter()
    .sort()
    .paginate()
    .build()
    .populate("actorId", "name email roles");

  const meta = await queryBuilder.getMeta();
  return { data: logs, meta };
};

export const AuditLogServices = {
  record,
  getAuditLogs,
};
