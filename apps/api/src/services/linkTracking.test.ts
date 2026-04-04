import { describe, expect, it } from "vitest";
import { buildAdminTracking, calculateBundleProgress, getAssetDurationSeconds } from "./linkTracking.js";

describe("linkTracking helpers", () => {
  it("uses the image timer as the image duration", () => {
    expect(
      getAssetDurationSeconds(
        {
          type: "image",
          durationSeconds: null,
        },
        12,
      ),
    ).toBe(12);
  });

  it("calculates 20 percent progress for a 100 second video watched for 20 seconds", () => {
    expect(
      calculateBundleProgress({
        assets: [
          {
            assetId: "video-1",
            type: "video",
            durationSeconds: 100,
            order: 0,
          },
        ],
        imageDisplaySeconds: 10,
        linkStatus: "active",
        session: {
          status: "active",
          currentAssetIndex: 0,
          currentAssetElapsedSeconds: 20,
          completedAssets: [],
        },
      }),
    ).toEqual({
      consumedSeconds: 20,
      totalDurationSeconds: 100,
      consumedPercent: 20,
    });
  });

  it("calculates whole bundle progress across completed and current assets", () => {
    expect(
      buildAdminTracking({
        linkStatus: "active",
        usesConsumed: 0,
        imageDisplaySeconds: 10,
        assets: [
          {
            assetId: "image-1",
            type: "image",
            durationSeconds: null,
            order: 0,
          },
          {
            assetId: "video-1",
            type: "video",
            durationSeconds: 100,
            order: 1,
          },
        ],
        activeSession: {
          status: "active",
          currentAssetIndex: 1,
          currentAssetElapsedSeconds: 20,
          completedAssets: [
            {
              assetId: "image-1",
              completedAt: new Date("2026-04-04T00:00:00.000Z"),
            },
          ],
        },
      }),
    ).toEqual({
      trackingState: "viewing",
      consumedSeconds: 30,
      totalDurationSeconds: 110,
      consumedPercent: 27,
    });
  });
});
