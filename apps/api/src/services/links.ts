import type { Request } from "express";
import {
  interpolateMobileMessage,
  limitationCopy,
  type DeviceType,
  type PublicLinkPayload,
  type PublicSessionPayload,
} from "@secure-viewer/shared";
import { SecureLinkModel, type SecureLinkDocument } from "../models/SecureLink.js";
import { ViewerSessionModel } from "../models/ViewerSession.js";
import { storageProvider } from "../storage/storage.js";
import { hashToken, issueLinkToken, signStreamTicket } from "../utils/crypto.js";
import { detectDeviceType } from "../utils/device.js";
import { recordAuditEvent } from "./audit.js";

type LinkAssetRecord = {
  assetId: string;
  type: "image" | "video" | "audio";
  originalName: string;
  mimeType: string;
  durationSeconds?: number | null;
  order: number;
  storageKey: string;
};

type CompletedAssetRecord = {
  assetId: string;
  openedAt?: Date | null;
  completedAt?: Date | null;
};

function sortAssets<T extends { order: number }>(assets: readonly T[]) {
  return [...assets].sort((left, right) => left.order - right.order);
}

function mapAssets(link: SecureLinkDocument) {
  return sortAssets(link.assets as unknown as LinkAssetRecord[]).map((asset) => ({
    id: asset.assetId,
    type: asset.type,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    durationSeconds: asset.durationSeconds ?? null,
    order: asset.order,
  }));
}

function scheduleCleanup(link: SecureLinkDocument) {
  const seconds = Math.min(300, Math.max(60, link.autoDeleteDelaySeconds ?? 300));
  link.cleanupAt = new Date(Date.now() + seconds * 1000);
}

export async function createSecureLink(input: {
  recipientName: string;
  mobileMessageTemplate: string;
  imageDisplaySeconds: number;
  maxUses: number;
  autoDeleteDelaySeconds: number;
  assets: Array<{
    id: string;
    type: "image" | "video" | "audio";
    originalName: string;
    mimeType: string;
    durationSeconds: number | null;
    order: number;
    storageKey: string;
  }>;
  createdBy: string;
  clientUrl: string;
}) {
  const { token, tokenHash } = issueLinkToken();
  const link = await SecureLinkModel.create({
    tokenHash,
    recipientName: input.recipientName,
    mobileMessageTemplate: input.mobileMessageTemplate,
    imageDisplaySeconds: input.imageDisplaySeconds,
    maxUses: input.maxUses,
    usesConsumed: 0,
    status: "active",
    assets: input.assets.map((asset) => ({
      assetId: asset.id,
      type: asset.type,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      durationSeconds: asset.durationSeconds,
      order: asset.order,
      storageKey: asset.storageKey,
    })),
    createdBy: input.createdBy,
    autoDeleteDelaySeconds: input.autoDeleteDelaySeconds,
    warningMessage: limitationCopy,
  });

  return {
    linkId: String(link._id),
    token,
    viewerUrl: `${input.clientUrl.replace(/\/$/, "")}/view/${encodeURIComponent(token)}`,
  };
}

export async function findLinkByToken(token: string) {
  const tokenHash = hashToken(token);
  return SecureLinkModel.findOne({ tokenHash });
}

export async function getLinkById(linkId: string) {
  return SecureLinkModel.findById(linkId);
}

export function getLinkPayload(link: SecureLinkDocument): PublicLinkPayload {
  const remainingUses = Math.max(0, link.maxUses - link.usesConsumed);

  return {
    id: String(link._id),
    recipientName: link.recipientName,
    mobileMessage: interpolateMobileMessage(link.mobileMessageTemplate, link.recipientName),
    imageDisplaySeconds: link.imageDisplaySeconds,
    maxUses: link.maxUses,
    usesConsumed: link.usesConsumed,
    remainingUses,
    status: link.status,
    assets: mapAssets(link),
    warning: link.warningMessage ?? limitationCopy,
  };
}

export function resolveDevice(req: Request): DeviceType {
  return detectDeviceType(req.headers["user-agent"]);
}

export async function validatePublicLink(token: string, req: Request) {
  const deviceType = resolveDevice(req);
  const link = await findLinkByToken(token);

  if (!link) {
    return { status: 404 as const, payload: { message: "This link has expired" } };
  }

  if (["expired", "destroyed", "consumed"].includes(link.status)) {
    return { status: 410 as const, payload: { message: "This link has expired" } };
  }

  if (link.usesConsumed >= link.maxUses) {
    link.status = "consumed";
    link.expiredAt = new Date();
    scheduleCleanup(link);
    await link.save();
    return { status: 410 as const, payload: { message: "This link has expired" } };
  }

  link.lastDeviceType = deviceType;

  if (deviceType !== "desktop") {
    link.mobileOpenCount += 1;
    await link.save();
    await recordAuditEvent({
      linkId: String(link._id),
      type: "mobile-open",
      message: "Link opened on a non-desktop device",
      metadata: { deviceType },
    });
    return {
      status: 200 as const,
      payload: {
        deviceType,
        mode: "mobile",
        message: interpolateMobileMessage(link.mobileMessageTemplate, link.recipientName),
        warning: link.warningMessage ?? limitationCopy,
      },
    };
  }

  await link.save();

  return {
    status: 200 as const,
    payload: {
      deviceType,
      mode: "desktop",
      link: getLinkPayload(link),
    },
  };
}

export async function ensureNoActiveDesktopSession(linkId: string) {
  return ViewerSessionModel.findOne({
    linkId,
    status: { $in: ["active", "warning"] },
  });
}

export async function startViewerSession(token: string, req: Request, fullscreenAccepted = false) {
  const deviceType = resolveDevice(req);
  const link = await findLinkByToken(token);

  if (!link) {
    return { status: 404 as const, payload: { message: "This link has expired" } };
  }

  if (deviceType !== "desktop") {
    return { status: 400 as const, payload: { message: "Desktop access is required" } };
  }

  if (["expired", "destroyed", "consumed"].includes(link.status)) {
    return { status: 410 as const, payload: { message: "This link has expired" } };
  }

  if (link.usesConsumed >= link.maxUses) {
    link.status = "consumed";
    link.expiredAt = new Date();
    scheduleCleanup(link);
    await link.save();
    return { status: 410 as const, payload: { message: "This link has expired" } };
  }

  const activeSession = await ensureNoActiveDesktopSession(String(link._id));
  if (activeSession) {
    return { status: 409 as const, payload: { message: "A secure session is already active" } };
  }

  link.usesConsumed += 1;
  link.desktopOpenCount += 1;
  await link.save();

  const session = await ViewerSessionModel.create({
    linkId: link._id,
    deviceType,
    fingerprint: req.headers["x-client-fingerprint"] ?? null,
    fullscreenAccepted,
    warningCount: 0,
    status: "active",
    currentAssetIndex: 0,
    completedAssets: [],
  });

  await recordAuditEvent({
    linkId: String(link._id),
    sessionId: String(session._id),
    type: "desktop-session-start",
    message: "Desktop secure session started",
    metadata: { fullscreenAccepted },
  });

  const assets = mapAssets(link);
  const streamTickets = Object.fromEntries(
    assets.map((asset) => [
      asset.id,
      signStreamTicket({
        sessionId: String(session._id),
        assetId: asset.id,
        expiresAt: Date.now() + 5 * 60 * 1000,
      }),
    ]),
  );

  const payload: PublicSessionPayload & { streamTickets: Record<string, string> } = {
    sessionId: String(session._id),
    deviceType,
    warningCount: 0,
    status: "active",
    currentAssetIndex: 0,
    assets,
    completedAssetIds: [],
    streamTickets,
  };

  return { status: 200 as const, payload };
}

export async function recordAssetProgress(input: {
  sessionId: string;
  assetId: string;
  event: "opened" | "completed";
}) {
  const session = await ViewerSessionModel.findById(input.sessionId);
  if (!session) {
    return { status: 404 as const, payload: { message: "Session not found" } };
  }

  if (session.status === "destroyed") {
    return { status: 410 as const, payload: { message: "This link has expired" } };
  }

  const link = await SecureLinkModel.findById(session.linkId);
  if (!link) {
    return { status: 404 as const, payload: { message: "This link has expired" } };
  }

  const assets = sortAssets(link.assets as unknown as LinkAssetRecord[]);
  const currentAsset = assets[session.currentAssetIndex];

  if (!currentAsset || currentAsset.assetId !== input.assetId) {
    return { status: 400 as const, payload: { message: "Asset order mismatch" } };
  }

  const completedAssets = session.completedAssets as unknown as CompletedAssetRecord[];
  const existing = completedAssets.find((item) => item.assetId === input.assetId);

  if (input.event === "opened") {
    if (!existing) {
      completedAssets.push({
        assetId: input.assetId,
        openedAt: new Date(),
        completedAt: null,
      });
    } else if (!existing.openedAt) {
      existing.openedAt = new Date();
    }
  }

  if (input.event === "completed") {
    if (existing) {
      existing.completedAt = new Date();
      if (!existing.openedAt) {
        existing.openedAt = new Date();
      }
    } else {
      completedAssets.push({
        assetId: input.assetId,
        openedAt: new Date(),
        completedAt: new Date(),
      });
    }
    session.currentAssetIndex += 1;
  }

  await session.save();

  return {
    status: 200 as const,
    payload: {
      currentAssetIndex: session.currentAssetIndex,
      completedAssetIds: completedAssets
        .filter((item) => item.completedAt)
        .map((item) => item.assetId),
    },
  };
}

export async function finalizeSession(sessionId: string) {
  const session = await ViewerSessionModel.findById(sessionId);
  if (!session) {
    return { status: 404 as const, payload: { message: "Session not found" } };
  }

  const link = await SecureLinkModel.findById(session.linkId);
  if (!link) {
    return { status: 404 as const, payload: { message: "This link has expired" } };
  }

  const completedAssets = session.completedAssets as unknown as CompletedAssetRecord[];
  const allAssetsCompleted = sortAssets(link.assets as unknown as LinkAssetRecord[]).every((asset) =>
    completedAssets.some((item) => item.assetId === asset.assetId && item.completedAt),
  );

  if (!allAssetsCompleted) {
    return { status: 400 as const, payload: { message: "Content has not been fully consumed yet" } };
  }

  session.status = "completed";
  session.endedAt = new Date();
  await session.save();

  const hasRemainingUses = link.usesConsumed < link.maxUses;
  if (hasRemainingUses) {
    link.status = "active";
  } else {
    link.status = "consumed";
    link.expiredAt = new Date();
    scheduleCleanup(link);
  }

  await link.save();

  await recordAuditEvent({
    linkId: String(link._id),
    sessionId: String(session._id),
    type: "content-consumed",
    message: "All secure assets completed",
    metadata: { hasRemainingUses },
  });

  return {
    status: 200 as const,
    payload: {
      expired: !hasRemainingUses,
      message: hasRemainingUses
        ? "Session completed. This link still has remaining uses."
        : "This link has expired",
    },
  };
}

export async function reportSuspiciousEvent(input: { sessionId: string; event: string }) {
  const session = await ViewerSessionModel.findById(input.sessionId);
  if (!session) {
    return { status: 404 as const, payload: { message: "Session not found" } };
  }

  const link = await SecureLinkModel.findById(session.linkId);
  if (!link) {
    return { status: 404 as const, payload: { message: "This link has expired" } };
  }

  session.warningCount += 1;
  session.status = session.warningCount >= 2 ? "destroyed" : "warning";

  await recordAuditEvent({
    linkId: String(link._id),
    sessionId: String(session._id),
    type: "suspicious-event",
    message: "Suspicious viewer event detected",
    metadata: { event: input.event, warningCount: session.warningCount },
  });

  if (session.warningCount >= 2) {
    session.destroyReason = input.event;
    session.endedAt = new Date();
    await session.save();

    link.status = "destroyed";
    link.expiredAt = new Date();
    scheduleCleanup(link);
    await link.save();

    return {
      status: 200 as const,
      payload: { destroyed: true, message: "This link has expired", warningCount: session.warningCount },
    };
  }

  await session.save();

  return {
    status: 200 as const,
    payload: {
      destroyed: false,
      message: "Screenshot/Recording not allowed",
      warningCount: session.warningCount,
    },
  };
}

export async function destroySessionOrLink(input: { sessionId?: string; token?: string; reason: string }) {
  const session = input.sessionId ? await ViewerSessionModel.findById(input.sessionId) : null;
  const link =
    (session ? await SecureLinkModel.findById(session.linkId) : null) ||
    (input.token ? await findLinkByToken(input.token) : null);

  if (!link) {
    return { status: 404 as const, payload: { message: "This link has expired" } };
  }

  if (session) {
    session.status = "destroyed";
    session.destroyReason = input.reason;
    session.endedAt = new Date();
    await session.save();
  }

  link.status = "destroyed";
  link.expiredAt = new Date();
  scheduleCleanup(link);
  await link.save();

  await recordAuditEvent({
    linkId: String(link._id),
    sessionId: session ? String(session._id) : null,
    type: "link-destroyed",
    message: input.reason,
    metadata: {},
  });

  return { status: 200 as const, payload: { message: "This link has expired" } };
}

export async function removeExpiredLinksAndMedia() {
  const links = await SecureLinkModel.find({
    cleanupAt: { $lte: new Date() },
  });

  for (const link of links) {
    for (const asset of link.assets) {
      await storageProvider.remove(asset.storageKey);
    }

    await ViewerSessionModel.deleteMany({ linkId: link._id });
    await link.deleteOne();
  }
}
