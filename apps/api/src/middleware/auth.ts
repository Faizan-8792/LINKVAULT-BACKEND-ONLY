import type { NextFunction, Request, Response } from "express";
import { hashToken, verifyJwt } from "../utils/crypto.js";
import { UserModel } from "../models/User.js";

export type AuthedRequest = Request & {
  user?: {
    id: string;
    status: string;
    sessionId: string;
  };
};

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const token = header.slice("Bearer ".length);
    const payload = verifyJwt(token);
    const user = await UserModel.findById(payload.userId);

    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }

    if (!payload.sessionId || !user.adminSessionId || payload.sessionId !== user.adminSessionId) {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    const fingerprintHeader = req.headers["x-auth-fingerprint"];
    const fingerprint =
      typeof fingerprintHeader === "string"
        ? fingerprintHeader
        : Array.isArray(fingerprintHeader)
          ? fingerprintHeader[0]
          : "";

    if (!fingerprint || !user.adminFingerprintHash) {
      return res.status(401).json({ message: "Session fingerprint missing" });
    }

    if (hashToken(fingerprint) !== user.adminFingerprintHash) {
      return res.status(401).json({ message: "Session is locked to another browser" });
    }

    req.user = { id: String(user._id), status: user.status, sessionId: payload.sessionId };
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

export function requireApprovedAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }

  if (req.user.status !== "approved") {
    return res.status(403).json({ message: "Admin approval pending" });
  }

  next();
}
