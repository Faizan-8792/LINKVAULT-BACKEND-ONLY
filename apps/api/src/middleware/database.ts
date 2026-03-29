import type { Request, Response, NextFunction } from "express";
import { connectDatabase, getDatabaseStatus, isDatabaseReady } from "../db.js";

export async function requireDatabase(_req: Request, res: Response, next: NextFunction) {
  if (!isDatabaseReady()) {
    await connectDatabase();
  }

  if (isDatabaseReady()) {
    next();
    return;
  }

  const status = getDatabaseStatus();
  res.status(503).json({
    message:
      status.error ??
      "Database is not ready. Add a real MONGODB_URI in apps/api/.env and restart the API.",
    database: status,
  });
}
