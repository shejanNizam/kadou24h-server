/* eslint-disable no-console */
import { createAdapter } from "@socket.io/redis-adapter";
import { Server as HTTPServer } from "http";
import { JwtPayload } from "jsonwebtoken";
import { createClient } from "redis";
import { Server, Socket } from "socket.io";
import { configs } from "../app/config";
import { verifyToken } from "../app/utils/jwt";
import {
  canJoinConversation,
  canWatchDelivery,
  isAssignedRider,
  loadSocketUser,
} from "./socketAuth";

interface AuthSocket extends Socket {
  user: JwtPayload;
}

let io: Server;

export const initSocket = async (httpServer: HTTPServer): Promise<Server> => {
  io = new Server(httpServer, {
    cors: {
      origin: configs.frontend_url === "*" ? true : configs.frontend_url,
      credentials: configs.frontend_url !== "*",
    },
  });

  // Redis adapter — allows horizontal scaling across multiple server instances
  const pubClient = createClient({
    username: configs.REDIS.redis_username ?? "default",
    password: configs.REDIS.redis_password ?? "",
    socket: {
      host: configs.REDIS.redis_host ?? "localhost",
      port: parseInt(configs.REDIS.redis_port ?? "6379"),
    },
  });
  const subClient = pubClient.duplicate();

  pubClient.on("error", (err) => console.log("Socket Redis pub error:", err));
  subClient.on("error", (err) => console.log("Socket Redis sub error:", err));

  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  console.log("Socket.io Redis adapter connected.");

  // Authentication — same rules as the REST checkAuth: valid JWT, account exists,
  // not suspended / banned, and the token was not revoked (tokenVersion)
  io.use(async (socket: Socket, next) => {
    const token = (socket as AuthSocket).handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Authentication required"));

    let decoded: JwtPayload;
    try {
      decoded = verifyToken(token, configs.jwt_access_secret) as JwtPayload;
    } catch {
      return next(new Error("Invalid or expired token"));
    }

    try {
      const user = await loadSocketUser(String(decoded._id), decoded.tokenVersion ?? 0);
      if (!user) return next(new Error("Session expired or account unavailable"));
      (socket as AuthSocket).user = { ...decoded, roles: user.roles };
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const { _id: userId, roles = [] } = (socket as AuthSocket).user;
    // Deliveries this socket may broadcast location for (checked once, then cached)
    const riderDeliveries = new Set<string>();

    // Every user joins their personal room on connect — used to push targeted events
    socket.join(`user:${userId}`);

    // Conversation room: participants only
    socket.on("join_conversation", async (conversationId: string) => {
      if (await canJoinConversation(String(userId), String(conversationId)).catch(() => false)) {
        socket.join(`conv:${conversationId}`);
      } else {
        socket.emit("error_message", { event: "join_conversation", message: "Not allowed" });
      }
    });

    socket.on("leave_conversation", (conversationId: string) => {
      socket.leave(`conv:${conversationId}`);
    });

    // Relay typing indicators to the other participant(s) in the conversation
    socket.on("typing", ({ conversationId }: { conversationId: string }) => {
      socket.to(`conv:${conversationId}`).emit("typing", { conversationId, userId });
    });

    socket.on("stop_typing", ({ conversationId }: { conversationId: string }) => {
      socket.to(`conv:${conversationId}`).emit("stop_typing", { conversationId, userId });
    });

    socket.on("message_read", ({ conversationId }: { conversationId: string }) => {
      socket
        .to(`conv:${conversationId}`)
        .emit("message_read", { conversationId, userId, readAt: new Date() });
    });

    // Delivery tracking room: customer, store owner, riders of the leg chain, admins
    socket.on("join_delivery", async (deliveryId: string) => {
      const allowed = await canWatchDelivery(String(userId), roles, String(deliveryId)).catch(
        () => false,
      );
      if (allowed) {
        socket.join(`delivery:${deliveryId}`);
      } else {
        socket.emit("error_message", { event: "join_delivery", message: "Not allowed" });
      }
    });

    socket.on("leave_delivery", (deliveryId: string) => {
      socket.leave(`delivery:${deliveryId}`);
    });

    socket.on(
      "rider_location",
      async ({
        deliveryId,
        lat,
        lng,
        heading,
      }: {
        deliveryId: string;
        lat: number;
        lng: number;
        heading?: number;
      }) => {
        const id = String(deliveryId);
        if (!riderDeliveries.has(id)) {
          // Only the assigned rider may broadcast — prevents fake locations
          if (!(await isAssignedRider(String(userId), id).catch(() => false))) return;
          riderDeliveries.add(id);
        }
        if (typeof lat !== "number" || typeof lng !== "number") return;
        socket.to(`delivery:${id}`).emit("rider:location_updated", { deliveryId: id, lat, lng, heading });
      },
    );

    socket.on("disconnect", () => {
      socket.leave(`user:${userId}`);
    });
  });

  return io;
};

export const getIO = (): Server => {
  if (!io) throw new Error("Socket.io not initialized");
  return io;
};

/**
 * Closes every live socket of a user. Call it wherever sessions are revoked
 * (ban / suspension, logout everywhere, password change or reset, deletion),
 * so the user stops receiving real-time events immediately. The app reconnects
 * with a fresh token if it still has one.
 */
export const disconnectUser = (userId: string, reason = "session_revoked"): void => {
  try {
    const room = getIO().in(`user:${userId}`);
    room.emit("session:revoked", { reason });
    room.disconnectSockets(true);
  } catch {
    // socket not yet initialized, skip silently
  }
};

/**
 * Emit an event to a specific user regardless of which socket they're connected from.
 * Safe to call before socket init — silently skips if not ready.
 */
export const emitToUser = (userId: string, event: string, data: unknown): void => {
  try {
    getIO().to(`user:${userId}`).emit(event, data);
  } catch {
    // socket not yet initialized (e.g. during seeding), skip silently
  }
};

/**
 * Emit an event to all sockets that joined a conversation room.
 * Reaches users who currently have that chat open.
 */
export const emitToConversation = (conversationId: string, event: string, data: unknown): void => {
  try {
    getIO().to(`conv:${conversationId}`).emit(event, data);
  } catch {
    // socket not yet initialized, skip silently
  }
};

/**
 * Emit an event to all sockets watching a specific delivery tracking room.
 */
export const emitToDelivery = (deliveryId: string, event: string, data: unknown): void => {
  try {
    getIO().to(`delivery:${deliveryId}`).emit(event, data);
  } catch {
    // socket not yet initialized, skip silently
  }
};
