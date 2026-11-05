import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { IFileRef } from "../../interfaces/common.types";
import { CategoryType, ILocalizedText } from "./category.interface";
import { Category } from "./category.model";
import { Job } from "../job/job.model";
import { Product } from "../product/product.model";
import { ProfessionalProfile } from "../professional_profile/professional_profile.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";

interface CreateCategoryInput {
  name: ILocalizedText;
  type: CategoryType;
  parentId?: string | null;
  image?: IFileRef;
  isFeatured?: boolean;
  sortOrder?: number;
  isActive?: boolean;
}

interface UpdateCategoryInput {
  name?: Partial<ILocalizedText>;
  image?: IFileRef | null;
  isFeatured?: boolean;
  sortOrder?: number;
  isActive?: boolean;
}

const slugify = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // é -> e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const uniqueSlug = async (name: ILocalizedText, type: CategoryType) => {
  const base = `${type}-${slugify(name.en || name.fr)}`;
  let slug = base;
  for (let i = 2; await Category.exists({ slug }); i++) slug = `${base}-${i}`;
  return slug;
};

/** Throws unless `id` is an active category of the given type. Used by other modules. */
const assertCategory = async (id: string, type: CategoryType) => {
  const category = await Category.findOne({ _id: id, type, isActive: true });
  if (!category) {
    throw new AppError(httpStatus.BAD_REQUEST, "CATEGORY_INVALID", { type });
  }
  return category;
};

// ── Public ──

const getCategories = async (query: Record<string, string>) => {
  const filter: Record<string, unknown> = { isActive: true };
  if (query.type) filter.type = query.type;
  if (query.featured === "true") filter.isFeatured = true;
  // ?parentId=<id> → children; ?parentId=root → top level only
  if (query.parentId) filter.parentId = query.parentId === "root" ? null : query.parentId;

  return Category.find(filter).sort({ sortOrder: 1, "name.fr": 1 }).lean();
};

/** Top-level categories of one type, each with its active children. */
const getCategoryTree = async (type: CategoryType) => {
  const all = await Category.find({ type, isActive: true })
    .sort({ sortOrder: 1, "name.fr": 1 })
    .lean();

  const roots = all.filter((c) => !c.parentId);
  return roots.map((root) => ({
    ...root,
    children: all.filter((c) => String(c.parentId) === String(root._id)),
  }));
};

const getSingleCategory = async (id: string) => {
  const category = await Category.findById(id).lean();
  if (!category) throw new AppError(httpStatus.NOT_FOUND, "CATEGORY_NOT_FOUND");
  return category;
};

// ── Admin ──

const getAllCategoriesForAdmin = async (query: Record<string, string>) => {
  const filter: Record<string, unknown> = {};
  if (query.type) filter.type = query.type;
  if (query.isActive) filter.isActive = query.isActive === "true";
  return Category.find(filter).sort({ type: 1, sortOrder: 1 }).lean();
};

const createCategory = async (
  payload: CreateCategoryInput,
  actorId: string,
) => {
  if (payload.parentId) {
    const parent = await Category.findById(payload.parentId);
    if (!parent) throw new AppError(httpStatus.BAD_REQUEST, "PARENT_CATEGORY_NOT_FOUND");
    if (parent.type !== payload.type) {
      throw new AppError(httpStatus.BAD_REQUEST, "SUBCATEGORY_TYPE_MISMATCH");
    }
    if (parent.parentId) {
      throw new AppError(httpStatus.BAD_REQUEST, "CATEGORY_TOO_DEEP");
    }
  }

  const { parentId, ...rest } = payload;
  const category = await Category.create({
    ...rest,
    ...(parentId && { parentId }), // schema default is null = top level
    slug: await uniqueSlug(payload.name, payload.type),
    createdBy: actorId,
  });

  await AuditLogServices.record({
    actorId,
    action: "category.create",
    targetType: "category",
    targetId: String(category._id),
    after: { name: category.name, type: category.type },
  });

  return category;
};

const updateCategory = async (
  id: string,
  payload: UpdateCategoryInput,
  actorId: string,
) => {
  const category = await Category.findById(id);
  if (!category) throw new AppError(httpStatus.NOT_FOUND, "CATEGORY_NOT_FOUND");

  const before = category.toObject() as unknown as Record<string, unknown>;
  const { name, image, ...rest } = payload;

  category.set(rest);
  if (name) category.name = { ...category.toObject().name, ...name } as ILocalizedText;
  if (image === null) category.image = undefined;
  else if (image) category.image = image;
  await category.save();

  await AuditLogServices.record({
    actorId,
    action: "category.update",
    targetType: "category",
    targetId: id,
    before,
    after: payload as unknown as Record<string, unknown>,
  });

  return category;
};

// Hard delete only when nothing hangs under it; otherwise deactivate instead.
const deleteCategory = async (id: string, actorId: string) => {
  const category = await Category.findById(id);
  if (!category) throw new AppError(httpStatus.NOT_FOUND, "CATEGORY_NOT_FOUND");

  const hasChildren = await Category.exists({ parentId: id });
  if (hasChildren) {
    throw new AppError(
      httpStatus.CONFLICT,
      "CATEGORY_HAS_CHILDREN",
    );
  }

  // A category in use stays: deleting it would leave products / stores / jobs pointing nowhere
  const [products, vendors, jobs, workers] = await Promise.all([
    Product.countDocuments({ $or: [{ categoryId: id }, { subcategoryId: id }], isDeleted: { $ne: true } }),
    VendorProfile.countDocuments({ businessCategoryId: id }),
    Job.countDocuments({ categoryId: id }),
    ProfessionalProfile.countDocuments({ serviceCategoryId: id }),
  ]);
  if (products || vendors || jobs || workers) {
    throw new AppError(httpStatus.CONFLICT, "CATEGORY_IN_USE", { products, stores: vendors, jobs, workers });
  }

  await category.deleteOne();

  await AuditLogServices.record({
    actorId,
    action: "category.delete",
    targetType: "category",
    targetId: id,
    before: { name: category.name, type: category.type },
  });
};

export const CategoryServices = {
  assertCategory,
  getCategories,
  getCategoryTree,
  getSingleCategory,
  getAllCategoriesForAdmin,
  createCategory,
  updateCategory,
  deleteCategory,
};
