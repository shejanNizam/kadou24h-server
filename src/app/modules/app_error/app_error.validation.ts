import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).optional();

// Long stacks are cut, not refused: the report matters more than its tail
export const reportAppErrorZodSchema = z.object({
  message: z.string().trim().min(1).transform((s) => s.slice(0, 1000)),
  stack: z.string().optional().transform((s) => s?.slice(0, 8000)),
  fatal: z.boolean().default(false),
  screen: text(200),
  platform: text(20),
  osVersion: text(40),
  device: text(100),
  appVersion: text(40),
  updateId: text(80),
});
