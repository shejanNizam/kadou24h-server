import { model, Schema } from "mongoose";
import { fileRefSchema } from "../../utils/commonSchemas";
import { CategoryType, ICategory } from "./category.interface";

const categorySchema = new Schema<ICategory>(
  {
    name: {
      fr: { type: String, required: true, trim: true },
      en: { type: String, required: true, trim: true },
    },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    image: { type: fileRefSchema },
    parentId: { type: Schema.Types.ObjectId, ref: "Category", default: null },
    type: { type: String, enum: Object.values(CategoryType), required: true },
    isFeatured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

categorySchema.index({ type: 1, parentId: 1, isActive: 1, sortOrder: 1 });

export const Category = model<ICategory>("Category", categorySchema);
