import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import { loginSchema, signupSchema } from "@secure-viewer/shared";
import { requireDatabase } from "../middleware/database.js";
import { UserModel } from "../models/User.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { hashToken, issueJwt } from "../utils/crypto.js";
import { asyncHandler } from "../utils/http.js";

export const authRouter = Router();

authRouter.use(requireDatabase);

function isBcryptHash(value: string) {
  return /^\$2[aby]\$\d{2}\$/.test(value);
}

function readFingerprint(req: Request) {
  const raw = req.headers["x-auth-fingerprint"];
  const value = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  return value.trim();
}

authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const body = signupSchema.parse(req.body);
    const fingerprint = readFingerprint(req);

    if (!fingerprint) {
      return res.status(400).json({ message: "Browser fingerprint is required" });
    }

    const existing = await UserModel.findOne({ email: body.email.toLowerCase() });

    if (existing) {
      return res.status(409).json({ message: "Account already exists" });
    }

    const approvedCount = await UserModel.countDocuments({ status: "approved" });
    const status = approvedCount === 0 ? "approved" : "pending";
    const passwordHash = await bcrypt.hash(body.password, 10);
    const sessionId = randomUUID();

    const user = await UserModel.create({
      email: body.email.toLowerCase(),
      username: body.email.toLowerCase(),
      passwordHash,
      name: body.name,
      status,
      approvedAt: status === "approved" ? new Date() : null,
      adminSessionId: sessionId,
      adminFingerprintHash: hashToken(fingerprint),
      lastLoginAt: new Date(),
    });

    const token = issueJwt({ userId: String(user._id), status: user.status, sessionId });

    return res.status(201).json({
      token,
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        status: user.status,
        isApproved: user.status === "approved",
        createdAt: user.createdAt.toISOString(),
      },
    });
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const fingerprint = readFingerprint(req);
    if (!fingerprint) {
      return res.status(400).json({ message: "Browser fingerprint is required" });
    }

    const user = await UserModel.findOne({ email: body.email.toLowerCase() });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const legacyPassword = (user as any).password;
    let hashToVerify: string | null = null;

    if (typeof user.passwordHash === "string" && user.passwordHash.length > 0) {
      hashToVerify = user.passwordHash;
    } else if (typeof legacyPassword === "string" && isBcryptHash(legacyPassword)) {
      hashToVerify = legacyPassword;
    }

    let isValid = false;
    if (hashToVerify) {
      isValid = await bcrypt.compare(body.password, hashToVerify);
    } else if (typeof legacyPassword === "string" && legacyPassword.length > 0) {
      // Legacy fallback for plain-text password records from older schemas.
      isValid = body.password === legacyPassword;
    }

    if (!isValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const normalizedUsername =
      typeof user.username === "string" && user.username.length > 0
        ? user.username.toLowerCase()
        : user.email.toLowerCase();
    const sessionId = randomUUID();
    const shouldUpdatePasswordHash =
      !user.passwordHash || (typeof legacyPassword === "string" && legacyPassword.length > 0);

    const setUpdate: Record<string, unknown> = {
      username: normalizedUsername,
      adminSessionId: sessionId,
      adminFingerprintHash: hashToken(fingerprint),
      lastLoginAt: new Date(),
    };

    if (shouldUpdatePasswordHash) {
      setUpdate.passwordHash = hashToVerify ?? (await bcrypt.hash(body.password, 10));
    }

    const update: Record<string, unknown> = { $set: setUpdate };
    if (typeof legacyPassword === "string" && legacyPassword.length > 0) {
      update.$unset = { password: "" };
    }

    await UserModel.updateOne({ _id: user._id }, update);

    const token = issueJwt({ userId: String(user._id), status: user.status, sessionId });

    return res.json({
      token,
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        status: user.status,
        isApproved: user.status === "approved",
        createdAt: user.createdAt.toISOString(),
      },
    });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await UserModel.findById(req.user?.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        status: user.status,
        isApproved: user.status === "approved",
        createdAt: user.createdAt.toISOString(),
      },
    });
  }),
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    await UserModel.updateOne(
      { _id: req.user?.id },
      {
        $set: { adminSessionId: null, adminFingerprintHash: null },
      },
    );

    res.json({ ok: true });
  }),
);
