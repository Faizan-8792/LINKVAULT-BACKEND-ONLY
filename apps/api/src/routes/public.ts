import fs from "node:fs";
import { Router } from "express";
import {
  assetProgressSchema,
  consumeContentSchema,
  destroyLinkSchema,
  suspiciousReportSchema,
  startSessionSchema,
  validateLinkSchema,
} from "@secure-viewer/shared";
import { requireDatabase } from "../middleware/database.js";
import { SecureLinkModel } from "../models/SecureLink.js";
import { ViewerSessionModel } from "../models/ViewerSession.js";
import {
  destroySessionOrLink,
  finalizeSession,
  recordAssetProgress,
  reportSuspiciousEvent,
  startViewerSession,
  validatePublicLink,
} from "../services/links.js";
import { storageProvider } from "../storage/storage.js";
import { verifyStreamTicket } from "../utils/crypto.js";
import { asyncHandler } from "../utils/http.js";

export const publicRouter = Router();

publicRouter.use(requireDatabase);

publicRouter.post(
  "/validate-link",
  asyncHandler(async (req, res) => {
    const body = validateLinkSchema.parse(req.body);
    const result = await validatePublicLink(body.token, req);
    return res.status(result.status).json(result.payload);
  }),
);

publicRouter.post(
  "/start-session",
  asyncHandler(async (req, res) => {
    const body = startSessionSchema.parse(req.body);
    const result = await startViewerSession(body.token, req, body.fullscreenAccepted);
    return res.status(result.status).json(result.payload);
  }),
);

publicRouter.post(
  "/asset-progress",
  asyncHandler(async (req, res) => {
    const body = assetProgressSchema.parse(req.body);
    const result = await recordAssetProgress(body);
    return res.status(result.status).json(result.payload);
  }),
);

publicRouter.post(
  "/consume-content",
  asyncHandler(async (req, res) => {
    const body = consumeContentSchema.parse(req.body);
    const result = await finalizeSession(body.sessionId);
    return res.status(result.status).json(result.payload);
  }),
);

publicRouter.post(
  "/report-suspicious",
  asyncHandler(async (req, res) => {
    const body = suspiciousReportSchema.parse(req.body);
    const result = await reportSuspiciousEvent(body);
    return res.status(result.status).json(result.payload);
  }),
);

publicRouter.post(
  "/destroy-link",
  asyncHandler(async (req, res) => {
    const body = destroyLinkSchema.parse(req.body);
    const result = await destroySessionOrLink(body);
    return res.status(result.status).json(result.payload);
  }),
);

publicRouter.get(
  "/assets/:assetId/stream",
  asyncHandler(async (req, res) => {
    const ticket = String(req.query.ticket ?? "");
    const sessionId = String(req.query.sessionId ?? "");

    if (!ticket || !sessionId) {
      return res.status(400).json({ message: "Missing asset ticket" });
    }

    let decoded;
    try {
      decoded = verifyStreamTicket(ticket);
    } catch {
      return res.status(401).json({ message: "Invalid asset ticket" });
    }

    if (
      decoded.assetId !== req.params.assetId ||
      decoded.sessionId !== sessionId ||
      decoded.expiresAt < Date.now()
    ) {
      return res.status(401).json({ message: "Expired asset ticket" });
    }

    const session = await ViewerSessionModel.findById(sessionId);
    if (!session || session.status === "destroyed") {
      return res.status(410).json({ message: "Session unavailable" });
    }

    const secureLink = await SecureLinkModel.findById(session.linkId);
    if (!secureLink) {
      return res.status(404).json({ message: "Link not found" });
    }

    const asset = secureLink.assets.find((item: any) => item.assetId === req.params.assetId);
    if (!asset) {
      return res.status(404).json({ message: "Asset not found" });
    }

    const { size, path } = await storageProvider.stat(asset.storageKey);
    const range = req.headers.range;

    if (range) {
      const [startRaw, endRaw] = range.replace("bytes=", "").split("-");
      const start = Number(startRaw);
      const end = endRaw ? Number(endRaw) : size - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": asset.mimeType,
        "Cache-Control": "no-store",
      });

      fs.createReadStream(path, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      "Content-Length": size,
      "Content-Type": asset.mimeType,
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes",
    });

    fs.createReadStream(path).pipe(res);
  }),
);
