import { Types } from "mongoose";
import { IAppError } from "./app_error.interface";
import { AppErrorReport } from "./app_error.model";

const report = async (payload: Omit<IAppError, "userId" | "createdAt">, userId?: string) => {
  await AppErrorReport.create({ ...payload, userId: userId && Types.ObjectId.isValid(userId) ? userId : undefined });
};

/** Newest first; `fatal=true` keeps only the ones that closed the app */
const list = async (query: { page?: string; limit?: string; fatal?: string }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
  const filter = query.fatal === "true" ? { fatal: true } : {};
  const [rows, total] = await Promise.all([
    AppErrorReport.find(filter).populate("userId", "name phone").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AppErrorReport.countDocuments(filter),
  ]);
  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, data: rows };
};

export const AppErrorServices = { report, list };
