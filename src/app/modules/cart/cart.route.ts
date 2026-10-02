import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ALL_ROLES } from "../user/user.interface";
import { CartControllers } from "./cart.controller";
import { CartValidations } from "./cart.validation";

const router = Router();

router.use(checkAuth(...ALL_ROLES));

router.get("/", CartControllers.getMyCart);

router.post(
  "/items",
  validateRequest(CartValidations.addItemSchema),
  CartControllers.addToCart,
);

router.patch(
  "/items/:productId",
  validateRequest(CartValidations.updateQtySchema),
  CartControllers.updateItemQty,
);

router.delete("/items/:productId", CartControllers.removeItem);

router.delete("/", CartControllers.clearCart);

export const CartRoutes = router;
