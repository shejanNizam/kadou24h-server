/**
 * Order services entry point — the logic lives in order.*.service.ts by audience.
 */
import {
  calculateCheckout,
  placeOrder,
} from "./order.checkout.service";
import {
  getMyOrders,
  getOrderDetails,
  cancelOrder,
  cancelStorePart,
} from "./order.customer.service";
import {
  getVendorSubOrders,
  getVendorSubOrderDetail,
  updateSubOrderStatus,
  modifySubOrderItems,
  cancelVendorSubOrder,
} from "./order.vendor.service";
import {
  getAllOrdersAdmin,
  adminCancelSubOrder,
} from "./order.admin.service";

export const OrderServices = {
  calculateCheckout,
  placeOrder,
  getMyOrders,
  getOrderDetails,
  cancelOrder,
  cancelStorePart,
  getVendorSubOrders,
  getVendorSubOrderDetail,
  updateSubOrderStatus,
  modifySubOrderItems,
  cancelVendorSubOrder,
  getAllOrdersAdmin,
  adminCancelSubOrder,
};
