import { Document, Types } from "mongoose";

export enum AdPlacement {
  home = "home",
  category = "category",
  search = "search",
}

export enum AdType {
  banner = "banner",
  popup = "popup",
  interstitial = "interstitial",
}

export enum AdStatus {
  draft = "draft",
  scheduled = "scheduled",
  active = "active",
  paused = "paused",
  expired = "expired",
}

export interface IAdvertisementInitial {
  name: string;
  advertiserName: string;
  type: AdType;
  placement: AdPlacement;
  images: string[];
  linkUrl?: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  status: AdStatus;
  impressions: number;
  clicks: number;
  createdBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export type IAdvertisement = IAdvertisementInitial & Document;
