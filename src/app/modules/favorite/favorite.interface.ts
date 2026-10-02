import { Document, Types } from "mongoose";

export interface IFavoriteInitial {
  userId: Types.ObjectId;
  productId: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export type IFavorite = IFavoriteInitial & Document;
