import { Router } from "express";
import { AddressRoutes } from "../modules/address/address.route";
import { AuditLogRoutes } from "../modules/audit_log/audit_log.route";
import { AuthRoutes } from "../modules/auth/auth.route";
import { CategoryRoutes } from "../modules/category/category.route";
import { DeviceTokenRoutes } from "../modules/device_token/device_token.route";
import { RiderProfileRoutes } from "../modules/rider_profile/rider_profile.route";
import { SettingsRoutes } from "../modules/settings/settings.route";
import { TransitStationRoutes } from "../modules/transit_station/transit_station.route";
import { UploadRoutes } from "../modules/upload/upload.route";
import { UserRoutes } from "../modules/user/user.route";
import { VendorProfileRoutes } from "../modules/vendor_profile/vendor_profile.route";
import { VendorRiderLinkRoutes } from "../modules/vendor_rider_link/vendor_rider_link.route";
import { WalletRoutes } from "../modules/wallet/wallet.route";
import { ProductRoutes } from "../modules/product/product.route";
import { FavoriteRoutes } from "../modules/favorite/favorite.route";
import { DeliveryRateRoutes } from "../modules/delivery_rate/delivery_rate.route";
import { CartRoutes } from "../modules/cart/cart.route";
import { OrderRoutes } from "../modules/order/order.route";
import { DeliveryRoutes } from "../modules/delivery/delivery.route";
import { PaymentRoutes } from "../modules/payment/payment.route";
import { ProfessionalProfileRoutes } from "../modules/professional_profile/professional_profile.route";
import { JobRoutes } from "../modules/job/job.route";
import { SubscriptionRoutes } from "../modules/subscription/subscription.route";
import { ChatRoutes } from "../modules/chat/chat.route";
import { ReportRoutes } from "../modules/report/report.route";
import { NotificationRoutes } from "../modules/notification/notification.route";
import { SupportTicketRoutes } from "../modules/support_ticket/support_ticket.route";
import { AdvertisementRoutes } from "../modules/advertisement/advertisement.route";
import { AdminDashboardRoutes } from "../modules/admin_dashboard/admin_dashboard.route";
import { ReviewRoutes } from "../modules/review/review.route";
import { BookingRoutes } from "../modules/booking/booking.route";
import { CouponRoutes } from "../modules/coupon/coupon.route";

const router = Router();

const moduleRoutes = [
  { path: "/auth", route: AuthRoutes },
  { path: "/user", route: UserRoutes },
  { path: "/device-token", route: DeviceTokenRoutes },
  { path: "/upload", route: UploadRoutes },
  { path: "/settings", route: SettingsRoutes },
  { path: "/audit-logs", route: AuditLogRoutes },
  { path: "/addresses", route: AddressRoutes },
  { path: "/categories", route: CategoryRoutes },
  { path: "/transit-stations", route: TransitStationRoutes },
  { path: "/vendors", route: VendorProfileRoutes },
  { path: "/riders", route: RiderProfileRoutes },
  { path: "/vendor-rider-links", route: VendorRiderLinkRoutes },
  { path: "/wallets", route: WalletRoutes },
  { path: "/products", route: ProductRoutes },
  { path: "/favorites", route: FavoriteRoutes },
  { path: "/delivery-rates", route: DeliveryRateRoutes },
  { path: "/cart", route: CartRoutes },
  { path: "/orders", route: OrderRoutes },
  { path: "/deliveries", route: DeliveryRoutes },
  { path: "/payments", route: PaymentRoutes },
  { path: "/professional-profiles", route: ProfessionalProfileRoutes },
  { path: "/jobs", route: JobRoutes },
  { path: "/subscriptions", route: SubscriptionRoutes },
  { path: "/conversations", route: ChatRoutes },
  { path: "/reports", route: ReportRoutes },
  { path: "/notifications", route: NotificationRoutes },
  { path: "/support-tickets", route: SupportTicketRoutes },
  { path: "/advertisements", route: AdvertisementRoutes },
  { path: "/admin/dashboard", route: AdminDashboardRoutes },
  { path: "/reviews", route: ReviewRoutes },
  { path: "/bookings", route: BookingRoutes },
  { path: "/coupons", route: CouponRoutes },
];

moduleRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

export default router;
