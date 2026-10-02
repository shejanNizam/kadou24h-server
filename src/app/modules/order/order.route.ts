import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, ALL_ROLES, UserRole } from "../user/user.interface";
import { OrderControllers } from "./order.controller";
import { OrderValidations } from "./order.validation";

const router = Router();
const vendorRoles = [UserRole.vendor, ...ADMIN_ROLES];

// --- Customer Order & Checkout Routes ---
router.post(
  "/checkout-summary",
  checkAuth(...ALL_ROLES),
  validateRequest(OrderValidations.checkoutSummarySchema),
  OrderControllers.checkoutSummary,
);

router.post(
  "/",
  checkAuth(...ALL_ROLES),
  validateRequest(OrderValidations.placeOrderSchema),
  OrderControllers.placeOrder,
);

router.get("/my-orders", checkAuth(...ALL_ROLES), OrderControllers.getMyOrders);

// --- Vendor Sub-Order Routes ---
router.get(
  "/vendor/sub-orders",
  checkAuth(...vendorRoles),
  OrderControllers.getVendorSubOrders,
);

router.get(
  "/vendor/sub-orders/:id",
  checkAuth(...vendorRoles),
  OrderControllers.getVendorSubOrderDetail,
);

router.patch(
  "/vendor/sub-orders/:id/status",
  checkAuth(...vendorRoles),
  validateRequest(OrderValidations.vendorStatusUpdateSchema),
  OrderControllers.updateSubOrderStatus,
);

router.patch(
  "/vendor/sub-orders/:id/modify",
  checkAuth(...vendorRoles),
  validateRequest(OrderValidations.vendorModifyOrderSchema),
  OrderControllers.modifySubOrderItems,
);

router.post(
  "/vendor/sub-orders/:id/cancel",
  checkAuth(...vendorRoles),
  validateRequest(OrderValidations.cancelOrderSchema),
  OrderControllers.cancelVendorSubOrder,
);

// --- Admin Order Routes ---
router.get(
  "/admin/all",
  checkAuth(...ADMIN_ROLES),
  OrderControllers.getAllOrdersAdmin,
);

router.get(
  "/admin/:id",
  checkAuth(...ADMIN_ROLES),
  OrderControllers.getAdminOrderDetail,
);

router.post(
  "/admin/sub-orders/:id/cancel",
  checkAuth(...ADMIN_ROLES),
  validateRequest(OrderValidations.cancelOrderSchema),
  OrderControllers.adminCancelSubOrder,
);

// --- Detail & Cancel by Customer ---
router.get("/:id", checkAuth(...ALL_ROLES), OrderControllers.getOrderDetails);

router.post(
  "/:id/cancel",
  checkAuth(...ALL_ROLES),
  validateRequest(OrderValidations.cancelOrderSchema),
  OrderControllers.cancelOrder,
);

export const OrderRoutes = router;
