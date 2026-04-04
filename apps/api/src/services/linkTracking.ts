import type { LinkStatus } from "@secure-viewer/shared";

export type TrackingState =
  | "idle"
  | "viewing"
  | "paused"
  | "completed"
  | "expired"
  | "destroyed";

export type TrackingAsset = {
  assetId: string;
  type: "image" | "video" | "audio";
  durationSeconds?: number | null;
  order: number;
};

export type TrackingCompletedAsset = {
  assetId: string;
  completedAt?: Date | null;
};

export type TrackingSession = {
  status: "active" | "warning" | "destroyed" | "completed";
  currentAssetIndex: number;
  currentAssetElapsedSeconds?: number | null;
  completedAssets?: TrackingCompletedAsset[] | null;
};

function sortAssets<T extends { order: number }>(assets: readonly T[]) {
  return [...assets].sort((left, right) => left.order - right.order);
}

export function getAssetDurationSeconds(
  asset: Pick<TrackingAsset, "type" | "durationSeconds">,
  imageDisplaySeconds: number,
) {
  if (asset.type === "image") {
    return Math.max(0, imageDisplaySeconds);
  }

  return Math.max(0, asset.durationSeconds ?? 0);
}

export function calculateBundleProgress(input: {
  assets: TrackingAsset[];
  imageDisplaySeconds: number;
  linkStatus: LinkStatus;
  session?: TrackingSession | null;
}) {
  const orderedAssets = sortAssets(input.assets);
  const totalDurationSeconds = orderedAssets.reduce(
    (sum, asset) => sum + getAssetDurationSeconds(asset, input.imageDisplaySeconds),
    0,
  );

  if (totalDurationSeconds <= 0) {
    return {
      consumedSeconds: 0,
      totalDurationSeconds: 0,
      consumedPercent: 0,
    };
  }

  if (input.linkStatus === "consumed" || input.session?.status === "completed") {
    return {
      consumedSeconds: Math.round(totalDurationSeconds),
      totalDurationSeconds: Math.round(totalDurationSeconds),
      consumedPercent: 100,
    };
  }

  const completedAssetIds = new Set(
    (input.session?.completedAssets ?? [])
      .filter((asset) => asset.completedAt)
      .map((asset) => asset.assetId),
  );

  let consumedSeconds = 0;

  orderedAssets.forEach((asset, index) => {
    const durationSeconds = getAssetDurationSeconds(asset, input.imageDisplaySeconds);

    if (completedAssetIds.has(asset.assetId)) {
      consumedSeconds += durationSeconds;
      return;
    }

    if (index === input.session?.currentAssetIndex) {
      const elapsedSeconds = Math.max(0, input.session.currentAssetElapsedSeconds ?? 0);
      consumedSeconds += Math.min(durationSeconds, elapsedSeconds);
    }
  });

  const clampedConsumedSeconds = Math.min(totalDurationSeconds, consumedSeconds);

  return {
    consumedSeconds: Math.round(clampedConsumedSeconds),
    totalDurationSeconds: Math.round(totalDurationSeconds),
    consumedPercent: Math.min(
      100,
      Math.max(0, Math.round((clampedConsumedSeconds / totalDurationSeconds) * 100)),
    ),
  };
}

export function deriveTrackingState(input: {
  linkStatus: LinkStatus;
  usesConsumed: number;
  activeSession?: TrackingSession | null;
  latestSession?: TrackingSession | null;
}): TrackingState {
  if (input.activeSession?.status === "warning") {
    return "paused";
  }

  if (input.activeSession?.status === "active") {
    return "viewing";
  }

  if (input.linkStatus === "destroyed") {
    return "destroyed";
  }

  if (input.linkStatus === "expired") {
    return "expired";
  }

  if (input.linkStatus === "consumed") {
    return "completed";
  }

  if (input.latestSession?.status === "completed" && input.usesConsumed > 0) {
    return "completed";
  }

  return "idle";
}

export function buildAdminTracking(input: {
  linkStatus: LinkStatus;
  usesConsumed: number;
  assets: TrackingAsset[];
  imageDisplaySeconds: number;
  activeSession?: TrackingSession | null;
  latestSession?: TrackingSession | null;
}) {
  const trackingState = deriveTrackingState(input);
  const session = input.activeSession ?? input.latestSession ?? null;
  const progress = calculateBundleProgress({
    assets: input.assets,
    imageDisplaySeconds: input.imageDisplaySeconds,
    linkStatus: input.linkStatus,
    session,
  });

  const consumedSeconds =
    typeof progress.consumedSeconds === "number" && Number.isFinite(progress.consumedSeconds)
      ? Math.max(0, Math.round(progress.consumedSeconds))
      : 0;
  const totalDurationSeconds =
    typeof progress.totalDurationSeconds === "number" && Number.isFinite(progress.totalDurationSeconds)
      ? Math.max(0, Math.round(progress.totalDurationSeconds))
      : 0;
  const consumedPercent =
    typeof progress.consumedPercent === "number" && Number.isFinite(progress.consumedPercent)
      ? Math.min(100, Math.max(0, Math.round(progress.consumedPercent)))
      : 0;

  return {
    trackingState,
    consumedSeconds,
    totalDurationSeconds,
    consumedPercent,
  };
}
