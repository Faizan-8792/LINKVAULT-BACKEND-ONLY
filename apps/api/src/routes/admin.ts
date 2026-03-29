import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { createLinkInputSchema, limitationCopy } from "@secure-viewer/shared";
import { config } from "../config.js";
import { requireApprovedAdmin, requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { requireDatabase } from "../middleware/database.js";
import { AuditEventModel } from "../models/AuditEvent.js";
import { SecureLinkModel } from "../models/SecureLink.js";
import { UserModel } from "../models/User.js";
import { ViewerSessionModel } from "../models/ViewerSession.js";
import { storageProvider } from "../storage/storage.js";
import { createSecureLink } from "../services/links.js";
import { asyncHandler } from "../utils/http.js";

const tempRoot = path.resolve(config.uploadRoot, "..", "temp");
const upload = multer({ dest: tempRoot });

async function ensureUploadDirs() {
  await fs.mkdir(config.uploadRoot, { recursive: true });
  await fs.mkdir(tempRoot, { recursive: true });
}

fsSync.mkdirSync(config.uploadRoot, { recursive: true });
fsSync.mkdirSync(tempRoot, { recursive: true });

export const adminRouter = Router();

adminRouter.use(requireDatabase);
adminRouter.use(requireAuth, requireApprovedAdmin);

adminRouter.get(
  "/pending-users",
  asyncHandler(async (_req, res) => {
    const users = await UserModel.find({ status: "pending" }).sort({ createdAt: -1 });
    res.json({
      users: users.map((user) => ({
        id: String(user._id),
        email: user.email,
        name: user.name,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
      })),
    });
  }),
);

adminRouter.post(
  "/users/:id/approve",
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await UserModel.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.status = "approved";
    user.createdBy = req.user?.id ?? null;
    user.approvedAt = new Date();
    await user.save();

    return res.json({ ok: true });
  }),
);

adminRouter.post(
  "/uploads",
  upload.array("files", 50),
  asyncHandler(async (req, res) => {
    await ensureUploadDirs();
    const files = (req.files ?? []) as Express.Multer.File[];

    if (!files.length) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    const assets = [];
    for (const file of files) {
      const stored = await storageProvider.save(file);
      const inferredType = file.mimetype.startsWith("image/")
        ? "image"
        : file.mimetype.startsWith("video/")
          ? "video"
          : "audio";

      assets.push({
        id: stored.assetId,
        type: inferredType,
        originalName: stored.originalName,
        mimeType: stored.mimeType,
        durationSeconds: null,
        order: assets.length,
        storageKey: stored.storageKey,
      });
    }

    return res.status(201).json({ assets });
  }),
);

adminRouter.post(
  "/links",
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = createLinkInputSchema.parse(req.body);
    const assets = req.body.assets as Array<{
      id: string;
      type: "image" | "video" | "audio";
      originalName: string;
      mimeType: string;
      durationSeconds: number | null;
      order: number;
      storageKey: string;
    }>;

    if (!assets.every((asset) => asset.storageKey)) {
      return res.status(400).json({ message: "Uploaded assets are missing storage keys" });
    }

    const link = await createSecureLink({
      ...body,
      assets,
      createdBy: req.user!.id,
      clientUrl: config.viewerUrl,
    });

    return res.status(201).json({ ...link, warning: limitationCopy });
  }),
);

adminRouter.get(
  "/links",
  asyncHandler(async (_req, res) => {
    const links = await SecureLinkModel.find().sort({ createdAt: -1 });
    res.json({
      links: links.map((link) => ({
        id: String(link._id),
        recipientName: link.recipientName,
        status: link.status,
        maxUses: link.maxUses,
        usesConsumed: link.usesConsumed,
        mobileOpenCount: link.mobileOpenCount,
        desktopOpenCount: link.desktopOpenCount,
        createdAt: link.createdAt.toISOString(),
        expiredAt: link.expiredAt?.toISOString() ?? null,
        assetCount: link.assets.length,
      })),
    });
  }),
);

adminRouter.get(
  "/links/:id",
  asyncHandler(async (req, res) => {
    const link = await SecureLinkModel.findById(req.params.id);
    if (!link) {
      return res.status(404).json({ message: "Link not found" });
    }

    return res.json({
      id: String(link._id),
      recipientName: link.recipientName,
      status: link.status,
      maxUses: link.maxUses,
      usesConsumed: link.usesConsumed,
      imageDisplaySeconds: link.imageDisplaySeconds,
      autoDeleteDelaySeconds: link.autoDeleteDelaySeconds,
      mobileMessageTemplate: link.mobileMessageTemplate,
      mobileOpenCount: link.mobileOpenCount,
      desktopOpenCount: link.desktopOpenCount,
      warning: link.warningMessage,
      assets: link.assets.map((asset: any) => ({
        id: asset.assetId,
        type: asset.type,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        durationSeconds: asset.durationSeconds,
        order: asset.order,
      })),
    });
  }),
);

adminRouter.post(
  "/links/:id/destroy",
  asyncHandler(async (req, res) => {
    const link = await SecureLinkModel.findById(req.params.id);
    if (!link) {
      return res.status(404).json({ message: "Link not found" });
    }

    link.status = "destroyed";
    link.expiredAt = new Date();
    link.cleanupAt = new Date(Date.now() + Math.min(300, Math.max(60, link.autoDeleteDelaySeconds)) * 1000);
    await link.save();

    return res.json({ ok: true });
  }),
);

adminRouter.delete(
  "/links/:id",
  asyncHandler(async (req, res) => {
    const link = await SecureLinkModel.findById(req.params.id);
    if (!link) {
      return res.status(404).json({ message: "Link not found" });
    }

    await Promise.all(
      link.assets.map((asset: { storageKey: string }) => storageProvider.remove(asset.storageKey)),
    );
    await Promise.all([
      ViewerSessionModel.deleteMany({ linkId: link._id }),
      AuditEventModel.deleteMany({ linkId: link._id }),
      link.deleteOne(),
    ]);

    return res.json({ ok: true });
  }),
);
