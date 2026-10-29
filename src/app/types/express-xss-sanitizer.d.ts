declare module "express-xss-sanitizer" {
  import { RequestHandler } from "express";
  export function xss(): RequestHandler;
  export function sanitize<T>(data: T, options?: { allowedKeys?: string[]; allowedTags?: string[] }): T;
}
