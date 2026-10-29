import { Types } from "mongoose";

/** A JavaScript error the mobile app hit on someone's phone (kept 30 days) */
export interface IAppError {
  message: string;
  stack?: string;
  /** true when the error closed the app */
  fatal: boolean;
  /** The screen open at the time, e.g. "/ride/[id]" */
  screen?: string;
  platform?: string;
  osVersion?: string;
  device?: string;
  appVersion?: string;
  /** The OTA update the phone was running: tells which code version crashed */
  updateId?: string;
  userId?: Types.ObjectId;
  createdAt?: Date;
}
