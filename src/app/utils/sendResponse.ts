import { Response } from "express";

interface TMeta {
  page: number;
  limit: number;
  totalPage?: number;
  totalPages?: number;
  total: number;
}

interface TResponse<T> {
  statusCode: number;
  success: boolean;
  message?: string;
  data: T;
  meta?: TMeta;
}

export default function sendResponse<T>(res: Response, data: TResponse<T>) {
  const meta = data.meta
    ? {
        page: data.meta.page,
        limit: data.meta.limit,
        total: data.meta.total,
        totalPage: data.meta.totalPage ?? data.meta.totalPages ?? 0,
        ...(data.meta.totalPages !== undefined
          ? { totalPages: data.meta.totalPages }
          : {}),
      }
    : undefined;

  res.status(data?.statusCode).json({
    statusCode: data.statusCode,
    success: data.success,
    message: data.message,
    data: data.data,
    meta,
  });
}
