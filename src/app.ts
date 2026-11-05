import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Application, Request, Response } from "express";
import mongoSanitize from "express-mongo-sanitize";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import { configs } from "./app/config/index";
import { swaggerSpec } from "./app/config/swagger.config";
import { globalErrorHandler } from "./app/middlewares/globalErrorHandler";
import { sanitizeInput } from "./app/middlewares/sanitizeInput";
import notFound from "./app/middlewares/notFound";
import { resolveLocale } from "./app/middlewares/locale";
import { globalLimiter } from "./app/middlewares/rateLimiter";
import { requestId } from "./app/middlewares/requestId";
import { HealthRoutes } from "./app/modules/health/health.route";
import { rideSharePage } from "./app/modules/ride/ride.share";
import router from "./app/routes/index";
import { logger } from "./app/utils/logger";

const app: Application = express();

// Assign a correlation ID to every request before anything else
app.use(requestId);
// The answer language (Accept-Language), read before anything can fail
app.use(resolveLocale);

// Security & performance — must come before body parsers
app.use(helmet());
app.use(compression());
app.use(
  morgan(configs.node_env === "production" ? "combined" : "dev", {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }),
);
app.set("trust proxy", configs.trust_proxy);
app.use(globalLimiter);

// Body parsers
// Payment webhooks keep the exact bytes: aggregators sign them
app.use(
  express.json({
    verify: (req, _res, buf) => {
      if ((req as { url?: string }).url?.includes("/payments/webhook/")) (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// Input sanitization — runs after body is parsed
// express-mongo-sanitize tries to replace req.query which is a getter-only property
// in newer router versions, so we sanitize req.query in-place instead
app.use((req, _res, next) => {
  if (req.body) req.body = mongoSanitize.sanitize(req.body);
  if (req.params) req.params = mongoSanitize.sanitize(req.params);
  if (req.query) {
    const clean = mongoSanitize.sanitize({ ...req.query });
    Object.keys(req.query).forEach((k) =>
      Reflect.deleteProperty(req.query as Record<string, unknown>, k),
    );
    Object.assign(req.query, clean);
  }
  next();
});
app.use(sanitizeInput);

app.use(cookieParser());
app.use(
  cors({
    origin: configs.frontend_url === "*" ? true : configs.frontend_url,
    credentials: configs.frontend_url !== "*",
  }),
);

// Health checks — outside /api/v1 so infra probes don't need auth headers
app.use("/health", HealthRoutes);

// API docs — only expose in non-production environments
if (configs.node_env !== "production") {
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get("/api/docs.json", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });
}

app.use("/api/v1", router);

// "Share my trip" page: a close one follows a moto-taxi ride in the browser
app.get("/r/:token", rideSharePage);

app.get("/", (_req: Request, res: Response) => {
  res.send(" Kadou24h Server is running");
});

app.use(globalErrorHandler);
app.use(notFound);

export default app;
