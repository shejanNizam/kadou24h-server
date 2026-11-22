import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, APP_ROLES, UserRole } from "../user/user.interface";
import { BookingControllers } from "./booking.controller";
import {
  adminCancelBookingZodSchema,
  cancelBookingZodSchema,
  changeStrikeZodSchema,
  createBookingZodSchema,
  createWorkerReviewZodSchema,
  declineBookingZodSchema,
  doneBookingZodSchema,
  notDoneBookingZodSchema,
  setWorkerReviewStatusZodSchema,
} from "./booking.validation";

const router = Router();
const app = checkAuth(...APP_ROLES);
const staff = checkAuth(...ADMIN_ROLES);
const admin = checkAuth(UserRole.admin, UserRole.super_admin);

/**
 * @swagger
 * /bookings/admin:
 *   get:
 *     tags: [Bookings]
 *     summary: Admin — all worker bookings (status, search by number / name / phone / profession; meta.counts per status)
 *     security: [{ bearerAuth: [] }]
 * /bookings/admin/penalties:
 *   get:
 *     tags: [Bookings]
 *     summary: Admin — cancellation penalties (role=worker|customer, active=true, search)
 *     security: [{ bearerAuth: [] }]
 * /bookings/admin/penalties/{id}:
 *   patch:
 *     tags: [Bookings]
 *     summary: Admin — lift a penalty, or soften a worker's suspension to 30 days of reduced visibility
 *     description: Body { action lift | soften, note? }. Audit-logged; the person is notified.
 *     security: [{ bearerAuth: [] }]
 * /bookings/admin/reviews:
 *   get:
 *     tags: [Bookings]
 *     summary: Admin — worker reviews (status, rating)
 *     security: [{ bearerAuth: [] }]
 * /bookings/admin/reviews/{id}:
 *   patch:
 *     tags: [Bookings]
 *     summary: Admin — hide or show a worker review (the rating is recomputed)
 *     security: [{ bearerAuth: [] }]
 * /bookings/admin/{id}:
 *   get:
 *     tags: [Bookings]
 *     summary: Admin — one booking with contacts, history, review and penalties
 *     security: [{ bearerAuth: [] }]
 * /bookings/admin/{id}/cancel:
 *   patch:
 *     tags: [Bookings]
 *     summary: Admin — cancel an open booking (reason required; never a penalty)
 *     security: [{ bearerAuth: [] }]
 */
router.get("/admin", staff, BookingControllers.getBookingsForAdmin);
router.get("/admin/penalties", staff, BookingControllers.listStrikes);
router.patch("/admin/penalties/:id", admin, validateRequest(changeStrikeZodSchema), BookingControllers.changeStrike);
router.get("/admin/reviews", staff, BookingControllers.getReviewsForAdmin);
router.patch("/admin/reviews/:id", admin, validateRequest(setWorkerReviewStatusZodSchema), BookingControllers.setReviewStatus);
router.get("/admin/:id", staff, BookingControllers.getBookingForAdmin);
router.patch("/admin/:id/cancel", admin, validateRequest(adminCancelBookingZodSchema), BookingControllers.cancelByAdmin);

/**
 * @swagger
 * /bookings:
 *   post:
 *     tags: [Bookings]
 *     summary: Book a worker — { workerProfileId, scheduledAt, addressId?, description, photos? }
 *     description: >
 *       The worker answers within 24 h (or before the date if sooner), else the request expires.
 *       Payment is made directly to the worker (cash / Orange Money), never through the app.
 *       Limits: one open booking per worker, 5 requests waiting at once, one booking at a time
 *       while limited after cancellations.
 *     security: [{ bearerAuth: [] }]
 *   get:
 *     tags: [Bookings]
 *     summary: My bookings — as=customer|worker, status=active|history|<status>; meta.counts per status
 *     security: [{ bearerAuth: [] }]
 * /bookings/me/standing:
 *   get:
 *     tags: [Bookings]
 *     summary: My cancellations in the last 30 days and booking limit (customer side)
 *     security: [{ bearerAuth: [] }]
 * /bookings/{id}:
 *   get:
 *     tags: [Bookings]
 *     summary: One booking (customer or worker). Phones and the full address only once accepted.
 *     security: [{ bearerAuth: [] }]
 * /bookings/{id}/accept:
 *   patch: { tags: [Bookings], summary: "Worker accepts a request", security: [{ bearerAuth: [] }] }
 * /bookings/{id}/decline:
 *   patch: { tags: [Bookings], summary: "Worker declines a request — { reason? } (never a penalty)", security: [{ bearerAuth: [] }] }
 * /bookings/{id}/cancel:
 *   patch:
 *     tags: [Bookings]
 *     summary: Cancel — { reason } (required after acceptance)
 *     description: After acceptance it counts toward the penalties (rolling 30 days); the response has { booking, penalty }.
 *     security: [{ bearerAuth: [] }]
 * /bookings/{id}/done:
 *   patch: { tags: [Bookings], summary: "Worker marks the job done — { agreedPrice? }; the customer confirms within 48 h", security: [{ bearerAuth: [] }] }
 * /bookings/{id}/confirm:
 *   patch: { tags: [Bookings], summary: "Customer confirms the job is done", security: [{ bearerAuth: [] }] }
 * /bookings/{id}/not-done:
 *   patch: { tags: [Bookings], summary: "Customer says the job is not finished — { note? } (back to accepted)", security: [{ bearerAuth: [] }] }
 * /bookings/{id}/review:
 *   post: { tags: [Bookings], summary: "Customer reviews a completed booking — { rating 1-5, comment?, photos? }", security: [{ bearerAuth: [] }] }
 */
router.post("/", app, validateRequest(createBookingZodSchema), BookingControllers.createBooking);
router.get("/", app, BookingControllers.getMyBookings);
router.get("/me/standing", app, BookingControllers.getMyStanding);
router.get("/:id", app, BookingControllers.getMyBooking);
// "Delete from my history": a finished booking, hidden for my side only (client, 2026-11-22)
router.delete("/:id", app, BookingControllers.hideMyBooking);
router.patch("/:id/accept", app, BookingControllers.accept);
router.patch("/:id/decline", app, validateRequest(declineBookingZodSchema), BookingControllers.decline);
router.patch("/:id/cancel", app, validateRequest(cancelBookingZodSchema), BookingControllers.cancel);
router.patch("/:id/done", app, validateRequest(doneBookingZodSchema), BookingControllers.markDone);
router.patch("/:id/confirm", app, BookingControllers.confirmDone);
router.patch("/:id/not-done", app, validateRequest(notDoneBookingZodSchema), BookingControllers.reportNotDone);
router.post("/:id/review", app, validateRequest(createWorkerReviewZodSchema), BookingControllers.createReview);
// "Delete my review": the customer who wrote it (photos go, the worker's rating is redone)
router.delete("/:id/review", app, BookingControllers.deleteMyReview);

export const BookingRoutes = router;
