import crypto from "crypto";
import httpStatus from "http-status";
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import AppError from "../errorHelpers/AppError";
import { cloudinaryUpload } from "./cloudinary.config";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 10;

/**
 * What the app uploads: photos (products, KYC, chat, work), voice notes, CVs as PDF.
 * Anything else is refused, so the bucket can't be used to host pages or programs.
 * Both the type the phone declares and the file extension must match.
 */
const ALLOWED: Record<"image" | "audio" | "pdf", { mimes: string[]; extensions: string[] }> = {
  image: {
    mimes: ["image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"],
    extensions: ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"],
  },
  audio: {
    mimes: ["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/3gpp", "audio/amr", "video/3gpp", "video/webm", "video/mp4"],
    extensions: ["m4a", "mp4", "aac", "mp3", "webm", "ogg", "oga", "wav", "3gp", "amr"],
  },
  pdf: { mimes: ["application/pdf"], extensions: ["pdf"] },
};

export const uploadKind = (file: Pick<Express.Multer.File, "mimetype" | "originalname">) => {
  const mime = (file.mimetype || "").toLowerCase();
  const name = file.originalname || "";
  // Some Android file pickers give names without an extension: then the type decides
  const ext = name.includes(".") ? (name.split(".").pop() || "").toLowerCase() : null;
  for (const [kind, rule] of Object.entries(ALLOWED) as [keyof typeof ALLOWED, (typeof ALLOWED)[keyof typeof ALLOWED]][]) {
    if (rule.mimes.includes(mime) && (ext === null || rule.extensions.includes(ext))) return kind;
  }
  return null;
};

// Cloudinary keeps audio under "video" and PDFs under "image" (pages, previews); never "raw"
const RESOURCE_TYPE = { image: "image", audio: "video", pdf: "image" } as const;

const storage = new CloudinaryStorage({
  cloudinary: cloudinaryUpload,
  params: async (_req: Express.Request, file: Express.Multer.File) => {
    const baseName = file.originalname
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 60);

    return {
      folder: "uploads",
      resource_type: RESOURCE_TYPE[uploadKind(file) ?? "image"],
      public_id: `${crypto.randomUUID()}-${baseName}`,
    };
  },
});

export const multerUpload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES, fields: 20 },
  fileFilter: (_req, file, cb) => {
    if (uploadKind(file)) return cb(null, true);
    cb(new AppError(httpStatus.UNSUPPORTED_MEDIA_TYPE, "FILE_TYPE_NOT_ALLOWED"));
  },
});
