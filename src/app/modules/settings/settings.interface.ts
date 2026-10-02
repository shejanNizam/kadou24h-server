import { Document, Types } from "mongoose";
import { IAvatar } from "../user/user.interface";

export enum PayoutMethodType {
  orange_money = "orange_money",
  mobile_money = "mobile_money",
  bank = "bank",
}

export interface IWithdrawalFee {
  method: PayoutMethodType;
  type: "fixed" | "percent";
  value: number;
}

// All amounts are whole GNF.
export interface ISettingsInitial {
  platformName: string;
  supportEmail?: string;
  contactNumber?: string;
  whatsappSupportNumber?: string;
  defaultCurrency: string;
  logo?: IAvatar;

  commission: { rate: number; min: number }; // vendor pays max(rate% of subtotal, min)
  platformFee: number; // customer pays per order
  taxRate: number; // percent
  withdrawalFees: IWithdrawalFee[];
  riderCashLimitDefault: number; // max COD cash a rider may hold
  escrowReleaseHours: number; // wait after delivery before vendor money is withdrawable

  pricing: {
    jobPublishFee: number;
    cvUnlockFee: number;
    spontaneousApplicationFee: number;
  };

  moderation: {
    restrictAfter: number; // violations before chat is restricted
    suspendAfter: number; // violations before the account is suspended
    restrictHours: number;
  };

  emailToggles: {
    orderConfirmation: boolean;
    paymentVerification: boolean;
    invoice: boolean;
    disputeUpdates: boolean;
  };

  updatedBy?: Types.ObjectId;
}

export type ISettings = ISettingsInitial & Document;
