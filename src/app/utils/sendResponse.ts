import { Response } from "express";

interface TMeta {
  page: number;
  limit: number;
  total: number;
  totalPage?: number;
  /** @deprecated use totalPage — still accepted from older services */
  totalPages?: number;
  // Extra list info, e.g. notifications' unreadCount
  [key: string]: unknown;
}

interface TResponse<T> {
  statusCode: number;
  success: boolean;
  message?: string;
  data: T;
  meta?: TMeta;
}

export default function sendResponse<T>(res: Response, data: TResponse<T>) {
  let meta: Record<string, unknown> | undefined;

  if (data.meta) {
    const { totalPage, totalPages, ...rest } = data.meta;
    const pages =
      totalPage ?? totalPages ?? Math.ceil((data.meta.total || 0) / (data.meta.limit || 1));
    // `totalPage` is the documented field; `totalPages` is kept as an alias so
    // existing clients keep working
    meta = { ...rest, totalPage: pages, totalPages: pages };
  }

  res.status(data?.statusCode).json({
    statusCode: data.statusCode,
    success: data.success,
    message: data.message,
    data: data.data,
    meta,
  });
}
