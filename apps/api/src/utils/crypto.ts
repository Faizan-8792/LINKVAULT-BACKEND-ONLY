import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function issueLinkToken() {
  const token = `${crypto.randomUUID()}-${crypto.randomBytes(16).toString("hex")}`;
  return {
    token,
    tokenHash: hashToken(token),
  };
}

export function issueJwt(payload: { userId: string; status: string; sessionId: string }) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "12h" });
}

export function verifyJwt(token: string) {
  return jwt.verify(token, config.jwtSecret) as { userId: string; status: string; sessionId: string };
}

export function signStreamTicket(input: { sessionId: string; assetId: string; expiresAt: number }) {
  return jwt.sign(input, config.streamTokenSecret);
}

export function verifyStreamTicket(token: string) {
  return jwt.verify(token, config.streamTokenSecret) as {
    sessionId: string;
    assetId: string;
    expiresAt: number;
  };
}
