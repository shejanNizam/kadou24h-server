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

  orders: {
    // A store that doesn't accept a new order in time loses it: cancelled, the customer told (client, 2026-11-21)
    acceptMinutes: number;
  };

  // Moto-taxi (A → B): Kadou24h suggests the price, riders may ask more, paid in cash to the rider
  rides: {
    enabled: boolean;
    baseFare: number; // GNF at pickup
    perKm: number; // GNF per road km
    minFare: number; // GNF, shortest rides
    // Client 2026-11-21: riders may ask up to this % above the suggested price (rain, night, bad road)
    maxRaisePercent: number;
    // Client 2026-11-21: only riders this close to the pickup get the request
    searchRadiusKm: number;
    // Client 2026-10-23: free at first, later a monthly subscription for moto riders (never a commission)
    subscriptionRequired: boolean;
    trialDays: number; // free days each rider gets once the subscription is required
  };

  // Chat messages older than this are deleted (client, 2026-11-22); open disputes, refunds,
  // reports and orders still going keep their messages
  chat: {
    retentionDays: number;
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
