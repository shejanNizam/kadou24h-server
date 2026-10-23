/**
 * Delivery services entry point — the logic lives in delivery.*.service.ts by stage.
 */
import {
  createDeliveryLegsForSubOrder,
} from "./delivery.legs.service";
import {
  getAvailableRiders,
  assignRider,
  acceptDelivery,
  declineDelivery,
} from "./delivery.assignment.service";
import {
  goingToPickup,
  verifyPickup,
  verifyHandover,
} from "./delivery.handover.service";
import { DeliveryDispatch } from "./delivery.dispatch.service";
import {
  trackDelivery,
  updateRiderLocation,
  toggleRiderOnline,
  getMyDeliveries,
} from "./delivery.tracking.service";

export const DeliveryServices = {
  createDeliveryLegsForSubOrder,
  getAvailableRiders,
  assignRider,
  acceptDelivery,
  declineDelivery,
  goingToPickup,
  verifyPickup,
  verifyHandover,
  trackDelivery,
  updateRiderLocation,
  toggleRiderOnline,
  getMyDeliveries,
  getOffers: DeliveryDispatch.getOffers,
  claimOffer: DeliveryDispatch.claimOffer,
  skipOffer: DeliveryDispatch.skipOffer,
};
