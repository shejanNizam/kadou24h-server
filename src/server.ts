import http, { Server } from "http";
import mongoose from "mongoose";
import app from "./app";
import { configs } from "./app/config/index";
import { connectRedis, redisClient } from "./app/config/redis.config";
import { seedAdmin } from "./app/utils/seedAdmin";
import { seedSuperAdmin } from "./app/utils/seedSuperAdmin";
import { logger } from "./app/utils/logger";
import { initSocket } from "./socket/socket";
import { OrderPaymentServices } from "./app/modules/order/order.payment.service";
import { OrderAcceptServices } from "./app/modules/order/order.accept.service";
import { BookingServices } from "./app/modules/booking/booking.service";
import { DeliveryDispatch } from "./app/modules/delivery/delivery.dispatch.service";
import { RideServices } from "./app/modules/ride/ride.service";
import { ProfessionalProfileServices } from "./app/modules/professional_profile/professional_profile.service";
import { TeamBroadcastServices } from "./app/modules/notification/team_broadcast.service";
import { ChatMergeServices } from "./app/modules/chat/chat.merge.service";
import { ChatRetentionServices } from "./app/modules/chat/chat.retention.service";

let server: Server;

async function main() {
  try {
    await mongoose.connect(configs.database_url);
    logger.info("Connected to DB");

    await connectRedis();
    await seedSuperAdmin();
    await seedAdmin();
    // Workers listed before the approval step stay visible
    const legacyWorkers = await ProfessionalProfileServices.approveLegacyListedWorkers();
    if (legacyWorkers) logger.info(`Marked ${legacyWorkers} existing listed worker(s) as approved`);
    // One chat per customer and store: chats opened per order are merged (once)
    const mergedChats = await ChatMergeServices.mergeStoreChats();
    if (mergedChats) logger.info(`Merged ${mergedChats} per-order store chat(s) into store chats`);

    const httpServer = http.createServer(app);
    await initSocket(httpServer);

    server = httpServer.listen(configs.port, () => {
      logger.info(`Server running on port ${configs.port} [${configs.node_env}]`);
    });
    // Online orders not paid in time are cancelled and their stock released
    OrderPaymentServices.startPaymentExpirySweep();
    // New orders a store does not accept in time are cancelled (reminder half-way)
    OrderAcceptServices.startAcceptSweep();
    // Worker bookings: unanswered requests expire, unconfirmed jobs complete, visibility notices
    BookingServices.startBookingSweep();
    // Open dispatch: offers reach farther riders, unanswered store picks expire, nobody-took-it alerts
    DeliveryDispatch.startDispatchSweep();
    // Moto-taxi: requests reach farther riders, unanswered ones expire
    RideServices.startRideSweep();
    // Chat messages older than the retention period are deleted (proof still needed stays)
    ChatRetentionServices.startRetentionSweep();
    // Team broadcasts cut short by a restart carry on
    const broadcasts = await TeamBroadcastServices.resumeUnfinished();
    if (broadcasts) logger.info(`Resuming ${broadcasts} team broadcast(s)`);
  } catch (error) {
    logger.error("Startup failed", { error });
    process.exit(1);
  }
}
main();

const gracefulShutdown = async (signal: string, exitCode: number) => {
  logger.info(`${signal} received — shutting down gracefully`);
  if (server) {
    server.close(async () => {
      await mongoose.connection.close();
      await redisClient.quit();
      logger.info("Server closed");
      process.exit(exitCode);
    });
  } else {
    process.exit(exitCode);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM", 0));
process.on("SIGINT", () => gracefulShutdown("SIGINT", 0));

process.on("unhandledRejection", (err) => {
  logger.error("Unhandled Rejection", { error: err });
  gracefulShutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception", { error: err });
  gracefulShutdown("uncaughtException", 1);
});
