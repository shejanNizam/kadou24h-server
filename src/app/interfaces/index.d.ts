import { JwtPayload } from "jsonwebtoken";
import type { Locale } from "../i18n/locale";
declare global {
  namespace Express {
    interface Request {
      user: JwtPayload;
      id: string;
      /** The language to answer in, when the request or the signed-in user chose one (see middlewares/locale) */
      locale?: Locale;
    }
  }
}
