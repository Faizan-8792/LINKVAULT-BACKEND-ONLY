import cors from "cors";
import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { getDatabaseStatus } from "./db.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { publicRouter } from "./routes/public.js";

export function createApp() {
  const app = express();
  const configuredOrigin = new URL(config.clientUrl).origin;

  function isAllowedOrigin(origin?: string) {
    if (!origin) {
      return true;
    }

    if (origin === configuredOrigin) {
      return true;
    }

    // Support common local-dev origins (localhost, 127.0.0.1, LAN IPs) with any port.
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/i.test(origin)) {
      return true;
    }

    return false;
  }

  app.use(
    cors({
      origin(origin, callback) {
        if (isAllowedOrigin(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error("CORS blocked: origin not allowed"));
      },
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      service: "LinkVault backend",
      health: "/api/health",
    });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, database: getDatabaseStatus() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/public", publicRouter);

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    res.status(500).json({ message: error.message || "Internal server error" });
  });

  return app;
}
