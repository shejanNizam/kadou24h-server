import { Router } from "express";
import z from "zod";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { objectIdSchema } from "../../utils/commonSchemas";
import { APP_ROLES } from "../user/user.interface";
import { FavoriteControllers } from "./favorite.controller";

const router = Router();

const toggleFavoriteZodSchema = z.object({
  body: z.object({
    productId: objectIdSchema,
  }),
});

// All favorite routes require signed-in user
router.use(checkAuth(...APP_ROLES));

router.get("/my-favorites", FavoriteControllers.getMyFavorites);
router.get("/check/:productId", FavoriteControllers.checkIsFavorite);
router.post(
  "/toggle",
  validateRequest(toggleFavoriteZodSchema),
  FavoriteControllers.toggleFavorite,
);

export const FavoriteRoutes = router;
