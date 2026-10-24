import { Document, Types } from "mongoose";

export enum ReviewStatus {
  visible = "visible",
  hidden = "hidden",
}

export interface IReviewInitial {
  authorId: Types.ObjectId;
  subOrderId: Types.ObjectId;
  vendorId: Types.ObjectId;
  productIds: Types.ObjectId[];
  riderId?: Types.ObjectId;
  rating: number; // 1–5
  comment?: string;
  status: ReviewStatus;
  reportCount: number;
  reportedBy?: Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export type IReview = IReviewInitial & Document;
