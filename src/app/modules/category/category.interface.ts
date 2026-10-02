import { Document, Types } from "mongoose";
import { IFileRef } from "../../interfaces/common.types";

export enum CategoryType {
  product = "product", // Groceries, Electronics… (products)
  business = "business", // vendor store category
  service = "service", // worker professions (Plumber, Electrician…)
  job = "job", // job board (Sales, Marketing…)
}

export interface ILocalizedText {
  fr: string;
  en: string;
}

export interface ICategoryInitial {
  name: ILocalizedText;
  slug: string;
  image?: IFileRef;
  parentId?: Types.ObjectId; // set = subcategory (max 2 levels)
  type: CategoryType;
  isFeatured: boolean; // "Top Categories" on Home
  sortOrder: number;
  isActive: boolean;
  createdBy?: Types.ObjectId;
}

export type ICategory = ICategoryInitial & Document;
