import type { Request } from "express";
import {
  interpolateMobileMessage,
  limitationCopy,
  type DeviceType,
  type PublicLinkPayload,
  type PublicMobilePayload,
  type PublicSessionPayload,
  type ViewerDeviceContext,
} from "@secure-viewer/shared";
import { config } from "../config.js";
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

function buildSessionPayload(input: {
  sessionId: string;
  deviceType: DeviceType;
  warningCount: number;
  status: "active" | "warning";
  currentAssetIndex: number;
  assets: ReturnType<typeof mapAssets>;
  completedAssetIds: string[];
}) {
  const streamTickets = Object.fromEntries(
    input.assets.map((asset) => [
      asset.id,
      signStreamTicket({
        sessionId: input.sessionId,
        assetId: asset.id,
        expiresAt: Date.now() + 5 * 60 * 1000,
      }),
    ]),
  );

  const payload: PublicSessionPayload & { streamTickets: Record<string, string> } = {
    sessionId: input.sessionId,
    deviceType: input.deviceType,
    warningCount: input.warningCount,
    status: input.status,
    currentAssetIndex: input.currentAssetIndex,
    assets: input.assets,
    completedAssetIds: input.completedAssetIds,
    streamTickets,
  };

  return payload;
}

function scheduleCleanup(link: SecureLinkDocument) {
  const seconds = Math.min(300, Math.max(60, link.autoDeleteDelaySeconds ?? 300));
  link.cleanupAt = new Date(Date.now() + seconds * 1000);
}

function readClientFingerprint(req: Request) {
  const header = req.headers["x-client-fingerprint"];
  return typeof header === "string" ? header : Array.isArray(header) ? header[0] : null;
}

async function expireLink(link: SecureLinkDocument, status: "expired" | "destroyed") {
  link.status = status;
  link.expiredAt = new Date();
  scheduleCleanup(link);
  await link.save();
}

async function loadSessionAndLink(sessionId: string) {
  const session = await ViewerSessionModel.findById(sessionId);
  if (!session) {
    return { status: 404 as const, payload: { message: "Session not found" } };
  }

  const link = await SecureLinkModel.findById(session.linkId);
  if (!link) {
    return { status: 404 as const, payload: { message: "This link has expired" } };
  }

  return { session, link };
}

function ensureCurrentAsset(
  link: SecureLinkDocument,
  currentAssetIndex: number,
  assetId: string,
) {
  const assets = sortAssets(link.assets as unknown as LinkAssetRecord[]);
  const currentAsset = assets[currentAssetIndex];

  if (!currentAsset || currentAsset.assetId !== assetId) {
    return { error: { status: 400 as const, payload: { message: "Asset order mismatch" } } };
  }

  return { assets, currentAsset };
}

function updateLinkAssetDuration(
  link: SecureLinkDocument,
  assetId: string,
  durationSeconds?: number | null,
) {
  if (typeof durationSeconds !== "number" || Number.isNaN(durationSeconds) || durationSeconds <= 0) {
    return;
  }

  const asset = (link.assets as unknown as LinkAssetRecord[]).find((item) => item.assetId === assetId);
  if (!asset || asset.type === "image") {
    return;
  }

  asset.durationSeconds = durationSeconds;
  link.markModified("assets");
}

function markLinkConsumedIfOutOfUses(link: SecureLinkDocument) {
  if (link.usesConsumed < link.maxUses) {
    return false;
  }

  link.status = "consumed";
  link.expiredAt = new Date();
  scheduleCleanup(link);
  return true;
}

function getCurrentAssetForSession(link: SecureLinkDocument, currentAssetIndex: number) {
  const assets = sortAssets(link.assets as unknown as LinkAssetRecord[]);
  return assets[currentAssetIndex] ?? null;
}

function clearIncompleteImageCutState(link: SecureLinkDocument, assetId: string) {
  if (link.incompleteImageAssetId !== assetId) {
    return false;
  }

  link.incompleteImageAssetId = null;
  link.incompleteImageCutCount = 0;
  return true;
}

async function registerIncompleteImageCut(input: {
  link: SecureLinkDocument;
  session: {
    _id: unknown;
    currentAssetIndex: number;
    currentAssetElapsedSeconds?: number | null;
    completedAssets?: CompletedAssetRecord[] | null;
  };
  event: string;
}) {
  const currentAsset = getCurrentAssetForSession(input.link, input.session.currentAssetIndex);
  if (!currentAsset || currentAsset.type !== "image") {
    return { tracked: false as const, expired: false as const, cutCount: 0 };
  }

  const completedAssets = input.session.completedAssets ?? [];
  const isAlreadyCompleted = completedAssets.some(
    (item) => item.assetId === currentAsset.assetId && item.completedAt,
  );

  if (isAlreadyCompleted) {
    return { tracked: false as const, expired: false as const, cutCount: 0 };
  }

  const nextCutCount =
    input.link.incompleteImageAssetId === currentAsset.assetId
      ? (input.link.incompleteImageCutCount ?? 0) + 1
      : 1;

  input.link.incompleteImageAssetId = currentAsset.assetId;
  input.link.incompleteImageCutCount = nextCutCount;

  await recordAuditEvent({
    linkId: String(input.link._id),
    sessionId: String(input.session._id),
    type: "incomplete-image-cut",
    message: "Secure image was interrupted before completion",
    metadata: {
      assetId: currentAsset.assetId,
      event: input.event,
      elapsedSeconds: Math.max(0, input.session.currentAssetElapsedSeconds ?? 0),
      cutCount: nextCutCount,
      requiredSeconds: input.link.imageDisplaySeconds,
    },
  });

  if (nextCutCount >= 2) {
    await expireLink(input.link, "expired");
    return { tracked: true as const, expired: true as const, cutCount: nextCutCount };
  }

  await input.link.save();
  return { tracked: true as const, expired: false as const, cutCount: nextCutCount };
}

export async function createSecureLink(input: {
  recipientName: string;
  mobileMessageTemplate: string;
  imageDisplaySeconds: number;
  maxUses: number;
  autoDeleteDelaySeconds: number;
  warningMessage?: string;
  replacementParentId?: string | null;
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
  const viewerUrl = `${input.clientUrl.replace(/\/$/, "")}/v/${encodeURIComponent(token)}`;
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
    replacementParentId: input.replacementParentId ?? null,
    viewerUrl,
    autoDeleteDelaySeconds: input.autoDeleteDelaySeconds,
    warningMessage: input.warningMessage ?? limitationCopy,
  });

  return {
    linkId: String(link._id),
    token,
    viewerUrl,
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

type MobileBlockResult = {
  status: 200;
  payload: PublicMobilePayload;
};

function mapAssetsForReplacement(link: SecureLinkDocument) {
  return sortAssets(link.assets as unknown as LinkAssetRecord[]).map((asset) => ({
    id: asset.assetId,
    type: asset.type,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    durationSeconds: asset.durationSeconds ?? null,
    order: asset.order,
    storageKey: asset.storageKey,
  }));
}

function buildMobileIssuedMessage(link: SecureLinkDocument) {
  const base = interpolateMobileMessage(link.mobileMessageTemplate, link.recipientName);
  return `${base}. Current link expired due to mobile access. Open the replacement URL on desktop only.`;
}

function buildMobilePermanentMessage(link: SecureLinkDocument) {
  const base = interpolateMobileMessage(link.mobileMessageTemplate, link.recipientName);
  return `${base}. This link is now permanently expired due to mobile access.`;
}

async function handleNonDesktopOpen(
  link: SecureLinkDocument,
  deviceType: DeviceType,
): Promise<MobileBlockResult> {
  link.lastDeviceType = deviceType;
  link.mobileOpenCount += 1;
  link.status = "expired";
  link.expiredAt = new Date();
  scheduleCleanup(link);

  const warning = link.warningMessage ?? limitationCopy;
  const remainingUses = Math.max(0, link.maxUses - link.usesConsumed);
  const isReplacementChild = Boolean(link.replacementParentId);

  await link.save();

  if (isReplacementChild || link.replacementChildId || remainingUses <= 0) {
    await recordAuditEvent({
      linkId: String(link._id),
      type: "mobile-open-expired",
      message: "Link expired after mobile access",
      metadata: { deviceType, replacementIssued: false },
    });
    return {
      status: 200,
      payload: {
        deviceType,
        mode: "mobile",
        message: buildMobilePermanentMessage(link),
        warning,
        currentLinkExpired: true,
        replacementKind: "permanent-expired",
      },
    };
  }

  try {
    const replacement = await createSecureLink({
      recipientName: link.recipientName,
      mobileMessageTemplate: link.mobileMessageTemplate,
      imageDisplaySeconds: link.imageDisplaySeconds,
      maxUses: remainingUses,
      autoDeleteDelaySeconds: link.autoDeleteDelaySeconds,
      warningMessage: warning,
      replacementParentId: String(link._id),
      assets: mapAssetsForReplacement(link),
      createdBy: String(link.createdBy),
      clientUrl: config.viewerUrl,
    });

    link.replacementChildId = replacement.linkId as any;
    await link.save();
    await recordAuditEvent({
      linkId: String(link._id),
      type: "mobile-replacement-issued",
      message: "Replacement link issued after mobile access",
      metadata: { deviceType, replacementLinkId: replacement.linkId },
    });

    return {
      status: 200,
      payload: {
        deviceType,
        mode: "mobile",
        message: buildMobileIssuedMessage(link),
        warning,
        currentLinkExpired: true,
        replacementKind: "issued",
        replacementUrl: replacement.viewerUrl,
      },
    };
  } catch {
    await recordAuditEvent({
      linkId: String(link._id),
      type: "mobile-replacement-failed",
      message: "Replacement link could not be created after mobile access",
      metadata: { deviceType },
    });
    return {
      status: 200,
      payload: {
        deviceType,
        mode: "mobile",
        message: buildMobilePermanentMessage(link),
        warning,
        currentLinkExpired: true,
        replacementKind: "permanent-expired",
      },
    };
  }
}

export function resolveDevice(req: Request, deviceContext?: ViewerDeviceContext): DeviceType {
  return detectDeviceType(req.headers["user-agent"], deviceContext);
}

export async function validatePublicLink(
  token: string,
  req: Request,
  deviceContext?: ViewerDeviceContext,
) {
  const deviceType = resolveDevice(req, deviceContext);
  const link = await findLinkByToken(token);

  if (!link) {
    return { status: 404 as const, payload: { message: "This link has expired" } };
  }

  if (["expired", "destroyed", "consumed"].includes(link.status)) {
    return { status: 410 as const, payload: { message: "This link has expired" } };
  }

  if (markLinkConsumedIfOutOfUses(link)) {
    await link.save();
    return { status: 410 as const, payload: { message: "This link has expired" } };
  }

  if (deviceType !== "desktop") {
    return handleNonDesktopOpen(link, deviceType);
  }

  const reopenExpiryResult = await expireLinkOnReopenIfNeeded(link, req);
  if (reopenExpiryResult) {
    return reopenExpiryResult;
  }

  link.lastDeviceType = deviceType;
  await link.save();

  await recordAuditEvent({
    linkId: String(link._id),
    type: "desktop-link-validated",
    message: "Desktop link opened",
    metadata: { fingerprint: readClientFingerprint(req) },
  });

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

async function findReopenExpirySession(linkId: string, fingerprint: string | null) {
  if (fingerprint) {
    const sameFingerprintSession = await ViewerSessionModel.findOne({
      linkId,
      status: { $in: ["active", "warning"] },
      expireOnReopen: true,
      fingerprint,
    }).sort({ createdAt: -1 });

    if (sameFingerprintSession) {
      return sameFingerprintSession;
    }
  }

  return ViewerSessionModel.findOne({
    linkId,
    status: { $in: ["active", "warning"] },
    expireOnReopen: true,
  }).sort({ createdAt: -1 });
}

async function expireLinkOnReopenIfNeeded(link: SecureLinkDocument, req: Request) {
  const fingerprint = readClientFingerprint(req);
  const reopenSession = await findReopenExpirySession(String(link._id), fingerprint);

  if (!reopenSession) {
    return null;
  }

  reopenSession.status = "destroyed";
  reopenSession.pauseReason = "refresh-after-pause";
  reopenSession.destroyReason = "refresh-after-pause";
  reopenSession.endedAt = new Date();
  await reopenSession.save();

  await expireLink(link, "expired");

  await recordAuditEvent({
    linkId: String(link._id),
    sessionId: String(reopenSession._id),
    type: "refresh-expired-link",
    message: "Link expired after refresh/reopen following pause attempt",
    metadata: { fingerprint },
  });

  return { status: 410 as const, payload: { message: "This link has expired" } };
}

export async function startViewerSession(
  token: string,
  req: Request,
  fullscreenAccepted = false,
  deviceContext?: ViewerDeviceContext,
) {
  const deviceType = resolveDevice(req, deviceContext);
  const fingerprint = readClientFingerprint(req);
  const link = await findLinkByToken(token);

  if (!link) {
    return { status: 404 as const, payload: { message: "This link has expired" } };
  }

  if (["expired", "destroyed", "consumed"].includes(link.status)) {
    return { status: 410 as const, payload: { message: "This link has expired" } };
  }

  if (markLinkConsumedIfOutOfUses(link)) {
    await link.save();
    return { status: 410 as const, payload: { message: "This link has expired" } };
  }

  if (deviceType !== "desktop") {
    return handleNonDesktopOpen(link, deviceType);
  }

  const reopenExpiryResult = await expireLinkOnReopenIfNeeded(link, req);
  if (reopenExpiryResult) {
    return reopenExpiryResult;
  }

  const activeSession = await ensureNoActiveDesktopSession(String(link._id));
  if (activeSession) {
    if (activeSession.fingerprint && fingerprint && activeSession.fingerprint === fingerprint) {
      const completedAssets = activeSession.completedAssets as unknown as CompletedAssetRecord[];
      const assets = mapAssets(link);

      activeSession.fullscreenAccepted = fullscreenAccepted;
      await activeSession.save();

      const payload = buildSessionPayload({
        sessionId: String(activeSession._id),
        deviceType: activeSession.deviceType as DeviceType,
        warningCount: activeSession.warningCount,
        status: activeSession.status,
        currentAssetIndex: activeSession.currentAssetIndex,
        assets,
        completedAssetIds: completedAssets
          .filter((item) => item.completedAt)
          .map((item) => item.assetId),
      });

      return { status: 200 as const, payload };
    }

    return { status: 409 as const, payload: { message: "A secure session is already active" } };
  }

  const session = await ViewerSessionModel.create({
    linkId: link._id,
    deviceType,
    fingerprint,
    fullscreenAccepted,
    warningCount: 0,
    status: "active",
    currentAssetIndex: 0,
    currentAssetElapsedSeconds: 0,
    completedAssets: [],
    escapeCount: 0,
    resumeUsed: false,
    pauseReason: null,
  });

  link.lastDeviceType = deviceType;
  link.desktopOpenCount += 1;
  await link.save();

  await recordAuditEvent({
    linkId: String(link._id),
    sessionId: String(session._id),
    type: "desktop-session-start",
    message: "Desktop secure session started",
    metadata: { fullscreenAccepted },
  });

  const assets = mapAssets(link);
  const payload = buildSessionPayload({
    sessionId: String(session._id),
    deviceType,
    warningCount: 0,
    status: "active",
    currentAssetIndex: 0,
    assets,
    completedAssetIds: [],
  });

  return { status: 200 as const, payload };
}

export async function recordAssetProgress(input: {
  sessionId: string;
  assetId: string;
  event: "opened" | "completed";
}) {
  const loaded = await loadSessionAndLink(input.sessionId);
  if ("status" in loaded) {
    return loaded;
  }

  const { session, link } = loaded;

  if (session.status === "destroyed") {
    return { status: 410 as const, payload: { message: "This link has expired" } };
  }

  if (session.status === "completed") {
    return { status: 400 as const, payload: { message: "Session already completed" } };
  }

  const resolved = ensureCurrentAsset(link, session.currentAssetIndex, input.assetId);
  if ("error" in resolved) {
    return resolved.error;
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
      session.markModified("completedAssets");
    } else if (!existing.openedAt) {
      existing.openedAt = new Date();
      session.markModified("completedAssets");
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
    session.currentAssetElapsedSeconds = 0;
    session.markModified("completedAssets");

    if (resolved.currentAsset.type === "image") {
      clearIncompleteImageCutState(link, input.assetId);
    }
  }

  await Promise.all([session.save(), link.save()]);

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

export async function recordSessionProgress(input: {
  sessionId: string;
  assetId: string;
  elapsedSeconds: number;
  durationSeconds?: number;
}) {
  const loaded = await loadSessionAndLink(input.sessionId);
  if ("status" in loaded) {
    return loaded;
  }

  const { session, link } = loaded;

  if (session.status === "destroyed") {
    return { status: 410 as const, payload: { message: "This link has expired" } };
  }

  if (session.status === "completed") {
    return { status: 400 as const, payload: { message: "Session already completed" } };
  }

  if (session.status !== "active") {
    return { status: 409 as const, payload: { message: "Session is paused" } };
  }

  const resolved = ensureCurrentAsset(link, session.currentAssetIndex, input.assetId);
  if ("error" in resolved) {
    return resolved.error;
  }

  const { currentAsset } = resolved;
  const nextDuration =
    currentAsset.type === "image"
      ? link.imageDisplaySeconds
      : Math.max(0, input.durationSeconds ?? currentAsset.durationSeconds ?? 0);
  const nextElapsedSeconds = Math.min(Math.max(0, input.elapsedSeconds), nextDuration || input.elapsedSeconds);

  session.currentAssetElapsedSeconds = nextElapsedSeconds;
  updateLinkAssetDuration(link, input.assetId, input.durationSeconds);

  await Promise.all([session.save(), link.save()]);

  return {
    status: 200 as const,
    payload: { ok: true },
  };
}

export async function finalizeSession(sessionId: string) {
  const loaded = await loadSessionAndLink(sessionId);
  if ("status" in loaded) {
    return loaded;
  }

  const { session, link } = loaded;
  const completedAssets = session.completedAssets as unknown as CompletedAssetRecord[];
  const allAssetsCompleted = sortAssets(link.assets as unknown as LinkAssetRecord[]).every((asset) =>
    completedAssets.some((item) => item.assetId === asset.assetId && item.completedAt),
  );

  if (!allAssetsCompleted) {
    return { status: 400 as const, payload: { message: "Content has not been fully consumed yet" } };
  }

  session.status = "completed";
  session.currentAssetElapsedSeconds = 0;
  session.pauseReason = null;
  session.endedAt = new Date();
  await session.save();

  link.usesConsumed += 1;
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

export async function resumeViewerSession(sessionId: string, fullscreenAccepted = false) {
  const loaded = await loadSessionAndLink(sessionId);
  if ("status" in loaded) {
    return loaded;
  }

  const { session, link } = loaded;

  if (["expired", "destroyed", "consumed"].includes(link.status)) {
    return { status: 410 as const, payload: { message: "This link has expired" } };
  }

  if (session.status !== "warning") {
    return { status: 400 as const, payload: { message: "Session is not waiting for resume" } };
  }

  if (session.pauseReason === "escape-key") {
    if (session.resumeUsed) {
      return { status: 410 as const, payload: { message: "Resume is no longer available" } };
    }
    session.resumeUsed = true;
  }

  session.status = "active";
  session.fullscreenAccepted = fullscreenAccepted;
  session.pauseReason = null;
  await session.save();

  await recordAuditEvent({
    linkId: String(link._id),
    sessionId: String(session._id),
    type: "session-resumed",
    message:
      session.resumeUsed && session.escapeCount > 0
        ? "Viewer resumed after one-time escape pause"
        : "Viewer resumed after warning pause",
    metadata: { fullscreenAccepted },
  });

  return {
    status: 200 as const,
    payload: {
      ok: true,
      resumeUsed: session.resumeUsed,
    },
  };
}

export async function reportSuspiciousEvent(input: { sessionId: string; event: string }) {
  const loaded = await loadSessionAndLink(input.sessionId);
  if ("status" in loaded) {
    return loaded;
  }

  const { session, link } = loaded;

  if (session.status === "destroyed") {
    return { status: 410 as const, payload: { message: "This link has expired" } };
  }

  if (session.status === "completed") {
    return { status: 400 as const, payload: { message: "Session already completed" } };
  }

  if (["escape-key", "window-blur", "visibility-hidden"].includes(input.event)) {
    const incompleteImageCut = await registerIncompleteImageCut({
      link,
      session: {
        _id: session._id,
        currentAssetIndex: session.currentAssetIndex,
        currentAssetElapsedSeconds: session.currentAssetElapsedSeconds,
        completedAssets: session.completedAssets as unknown as CompletedAssetRecord[],
      },
      event: input.event,
    });

    if (incompleteImageCut.expired) {
      session.status = "destroyed";
      session.pauseReason = input.event;
      session.destroyReason = input.event;
      session.endedAt = new Date();
      await session.save();

      await recordAuditEvent({
        linkId: String(link._id),
        sessionId: String(session._id),
        type: "incomplete-image-expired-link",
        message: "Link expired after the same secure image was cut twice",
        metadata: { event: input.event, cutCount: incompleteImageCut.cutCount },
      });

      return {
        status: 200 as const,
        payload: {
          destroyed: true,
          sessionEnded: true,
          resumeAllowed: false,
          linkExpired: true,
          message: "This link has expired",
        },
      };
    }
  }

  if (input.event === "escape-key") {
    session.escapeCount += 1;

    await recordAuditEvent({
      linkId: String(link._id),
      sessionId: String(session._id),
      type: "escape-key",
      message: "Escape key pressed in secure viewer",
      metadata: { escapeCount: session.escapeCount, resumeUsed: session.resumeUsed },
    });

    if (session.escapeCount >= 2) {
      session.status = "destroyed";
      session.pauseReason = "escape-key";
      session.destroyReason = "escape-key";
      session.endedAt = new Date();
      await session.save();

      await expireLink(link, "expired");

      await recordAuditEvent({
        linkId: String(link._id),
        sessionId: String(session._id),
        type: "escape-expired-link",
        message: "Link expired after second escape press",
      });

      return {
        status: 200 as const,
        payload: {
          destroyed: true,
          sessionEnded: true,
          resumeAllowed: false,
          linkExpired: true,
          message: "This link has expired",
        },
      };
    }

    session.status = "warning";
    session.pauseReason = "escape-key";
    await session.save();

    return {
      status: 200 as const,
      payload: {
        destroyed: false,
        sessionEnded: false,
        resumeAllowed: !session.resumeUsed,
        message: session.resumeUsed
          ? "Secure view paused, but the one-time resume is already used."
          : "Secure view paused. You can resume only once.",
      },
    };
  }

  if (input.event === "pause-attempt") {
    session.pauseAttemptCount = Math.max(0, session.pauseAttemptCount ?? 0) + 1;
    session.expireOnReopen = true;
  }

  session.warningCount += 1;
  session.status = session.warningCount >= 2 ? "destroyed" : "warning";
  session.pauseReason = session.warningCount >= 2 ? session.pauseReason : input.event;

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

    return {
      status: 200 as const,
      payload: {
        destroyed: false,
        sessionEnded: true,
        message: "Session closed due to repeated restricted actions. Reopen the link to continue.",
        warningCount: session.warningCount,
      },
    };
  }

  await session.save();

  return {
    status: 200 as const,
    payload: {
      destroyed: false,
      sessionEnded: false,
      resumeAllowed: true,
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
    session.pauseReason = null;
    session.destroyReason = input.reason;
    session.endedAt = new Date();
    await session.save();
  }

  await expireLink(link, "destroyed");

  await recordAuditEvent({
    linkId: String(link._id),
    sessionId: session ? String(session._id) : null,
    type: "link-destroyed",
    message: input.reason,
    metadata: {},
  });

  return { status: 200 as const, payload: { message: "This link has expired" } };
}

export async function removeAssetIfUnreferenced(storageKey: string, currentLinkId: string) {
  const referencedElsewhere = await SecureLinkModel.exists({
    _id: { $ne: currentLinkId },
    "assets.storageKey": storageKey,
  });
  if (!referencedElsewhere) {
    await storageProvider.remove(storageKey);
  }
}

export async function removeExpiredLinksAndMedia() {
  const links = await SecureLinkModel.find({
    cleanupAt: { $lte: new Date() },
  });

  for (const link of links) {
    for (const asset of link.assets) {
      await removeAssetIfUnreferenced(asset.storageKey, String(link._id));
    }

    await ViewerSessionModel.deleteMany({ linkId: link._id });
    await link.deleteOne();
  }
}
