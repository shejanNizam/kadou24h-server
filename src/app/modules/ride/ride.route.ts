import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, APP_ROLES, UserRole } from "../user/user.interface";
import { RideControllers } from "./ride.controller";
import {
  adminCancelRideZodSchema,
  answerCounterZodSchema,
  cancelRideZodSchema,
  counterBidZodSchema,
  estimateRideZodSchema,
  placeBidZodSchema,
  rateRideZodSchema,
  requestRideZodSchema,
} from "./ride.validation";

const router = Router();
const app = checkAuth(...APP_ROLES, ...ADMIN_ROLES);
const rider = checkAuth(UserRole.rider);
const staff = checkAuth(...ADMIN_ROLES);

/**
 * @swagger
 * /rides/estimate:
 *   post:
 *     tags: [Rides]
 *     summary: Moto-taxi price before ordering — { pickup {lat,lng}, dropoff {lat,lng} } → { distanceKm, durationMin, fare, ridersNearby }
 *     description: fare = max(minFare, baseFare + perKm × road km), rounded up to 500 GNF (settings.rides). Paid in cash to the rider.
 *     security: [{ bearerAuth: [] }]
 * /rides:
 *   post:
 *     tags: [Rides]
 *     summary: Order a moto-taxi — { pickup {lat,lng,address}, dropoff {lat,lng,address}, note?, pickupPhoto? }
 *     description: Nearby moto riders get the request (2 km, then 4, 7… up to settings.rides.searchRadiusKm, default 5). They answer with a price (fare … maxFare); the passenger chooses in ride.bids. Nobody in 10 min → expired. One running ride per passenger (409).
 *     security: [{ bearerAuth: [] }]
 * /rides/my:
 *   get:
 *     tags: [Rides]
 *     summary: My rides as a passenger (paginated)
 *     security: [{ bearerAuth: [] }]
 * /rides/my/current:
 *   get:
 *     tags: [Rides]
 *     summary: My running ride (searching → in_progress), or null
 *     security: [{ bearerAuth: [] }]
 * /rides/rider/offers:
 *   get:
 *     tags: [Rides]
 *     summary: Rider — ride requests near me, nearest first (suggestedFare, maxFare, pickupKm, myBid, bidsLeft). Empty while offline, with parcels on board or on a ride
 *     security: [{ bearerAuth: [] }]
 * /rides/rider/current:
 *   get:
 *     tags: [Rides]
 *     summary: Rider — my running ride (with the passenger's phone), or null
 *     security: [{ bearerAuth: [] }]
 * /rides/rider/history:
 *   get:
 *     tags: [Rides]
 *     summary: Rider — my rides (paginated)
 *     security: [{ bearerAuth: [] }]
 * /rides/admin:
 *   get:
 *     tags: [Rides]
 *     summary: Admin — all rides (status, search by number / address / name / phone; meta.counts, completedFares, completedKm)
 *     security: [{ bearerAuth: [] }]
 * /rides/admin/{id}:
 *   get:
 *     tags: [Rides]
 *     summary: Admin — one ride (passenger and rider details)
 *     security: [{ bearerAuth: [] }]
 * /rides/admin/{id}/cancel:
 *   post:
 *     tags: [Rides]
 *     summary: Admin — cancel a running ride { reason } (audit-logged; both are told)
 *     security: [{ bearerAuth: [] }]
 * /rides/{id}:
 *   get:
 *     tags: [Rides]
 *     summary: One ride (passenger, its rider or the team). The passenger sees the rider's name, photo, vehicle, rating and live position — never the phone
 *     security: [{ bearerAuth: [] }]
 * /rides/{id}/cancel:
 *   post:
 *     tags: [Rides]
 *     summary: Passenger cancels { reason? } — until the ride starts
 *     security: [{ bearerAuth: [] }]
 * /rides/{id}/rate:
 *   post:
 *     tags: [Rides]
 *     summary: Passenger rates the rider { stars 1–5, comment? } — once, after the ride
 *     security: [{ bearerAuth: [] }]
 * /rides/{id}/bid:
 *   post:
 *     tags: [Rides]
 *     summary: Rider sends a price { price? } — suggested fare (default) up to maxFare, steps of 500 GNF. The passenger has 60 s to answer. One live price at a time, 3 per ride
 *     security: [{ bearerAuth: [] }]
 *   delete:
 *     tags: [Rides]
 *     summary: Rider takes their waiting price back
 *     security: [{ bearerAuth: [] }]
 * /rides/{id}/bid/answer:
 *   post:
 *     tags: [Rides]
 *     summary: Rider answers the passenger's counter-offer { accept } — yes takes the ride at that price
 *     security: [{ bearerAuth: [] }]
 * /rides/{id}/bids/{bidId}/accept:
 *   post:
 *     tags: [Rides]
 *     summary: Passenger chooses this rider at their price — the other prices close
 *     security: [{ bearerAuth: [] }]
 * /rides/{id}/bids/{bidId}/decline:
 *   post:
 *     tags: [Rides]
 *     summary: Passenger declines this price
 *     security: [{ bearerAuth: [] }]
 * /rides/{id}/bids/{bidId}/counter:
 *   post:
 *     tags: [Rides]
 *     summary: Passenger counter-offers { price } once — between the suggested fare and the rider's price; the rider has 60 s to answer
 *     security: [{ bearerAuth: [] }]
 * /rides/{id}/skip:
 *   post:
 *     tags: [Rides]
 *     summary: Rider hides a ride request from their list
 *     security: [{ bearerAuth: [] }]
 * /rides/{id}/arrived:
 *   post:
 *     tags: [Rides]
 *     summary: Rider is at the pickup point (the passenger is told)
 *     security: [{ bearerAuth: [] }]
 * /rides/{id}/start:
 *   post:
 *     tags: [Rides]
 *     summary: Rider starts the ride (passenger on board)
 *     security: [{ bearerAuth: [] }]
 * /rides/{id}/complete:
 *   post:
 *     tags: [Rides]
 *     summary: Rider finishes the ride — collect the fare in cash
 *     security: [{ bearerAuth: [] }]
 * /rides/{id}/release:
 *   post:
 *     tags: [Rides]
 *     summary: Rider drops the ride before it starts { reason? } — it goes back to the other nearby riders
 *     security: [{ bearerAuth: [] }]
 */
router.post("/estimate", app, validateRequest(estimateRideZodSchema), RideControllers.estimate);
router.post("/", app, validateRequest(requestRideZodSchema), RideControllers.requestRide);
router.get("/my", app, RideControllers.getMyRides);
router.get("/my/current", app, RideControllers.getMyCurrentRide);
router.delete("/my/:id", app, RideControllers.hideMyRide);

router.get("/rider/offers", rider, RideControllers.getRideOffers);
router.get("/rider/current", rider, RideControllers.getRiderCurrentRide);
router.get("/rider/access", rider, RideControllers.getRiderAccess);
router.get("/rider/history", rider, RideControllers.getRiderRides);

router.get("/admin", staff, RideControllers.getRidesForAdmin);
router.get("/admin/:id", staff, RideControllers.getRideForAdmin);
router.post("/admin/:id/cancel", staff, validateRequest(adminCancelRideZodSchema), RideControllers.cancelByAdmin);

// "Share my trip": the passenger gets a link; the page at /r/:token reads /shared/:token (public)
router.get("/shared/:token", RideControllers.getSharedRide);
router.post("/:id/share", app, RideControllers.shareRide);

router.get("/:id", app, RideControllers.getRide);
router.post("/:id/cancel", app, validateRequest(cancelRideZodSchema), RideControllers.cancelRide);
router.post("/:id/rate", app, validateRequest(rateRideZodSchema), RideControllers.rateRide);
router.post("/:id/bid", rider, validateRequest(placeBidZodSchema), RideControllers.placeBid);
router.delete("/:id/bid", rider, RideControllers.withdrawBid);
router.post("/:id/bid/answer", rider, validateRequest(answerCounterZodSchema), RideControllers.answerCounter);
router.post("/:id/bids/:bidId/accept", app, RideControllers.acceptBid);
router.post("/:id/bids/:bidId/decline", app, RideControllers.declineBid);
router.post("/:id/bids/:bidId/counter", app, validateRequest(counterBidZodSchema), RideControllers.counterBid);
router.post("/:id/skip", rider, RideControllers.skipRide);
router.post("/:id/arrived", rider, RideControllers.arrived);
router.post("/:id/start", rider, RideControllers.startRide);
router.post("/:id/complete", rider, RideControllers.completeRide);
router.post("/:id/release", rider, validateRequest(cancelRideZodSchema), RideControllers.releaseRide);

export const RideRoutes = router;
