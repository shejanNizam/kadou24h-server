import { Language } from "../user/user.interface";

export enum OtpPurpose {
  verify_account = "verify_account",
  reset_password = "reset_password",
  change_phone = "change_phone",
}

export interface IOtpRecipient {
  name: string;
  language: Language;
  phone?: string; // receives the code by SMS
  email?: string; // receives the code by email
}
