import { describe, expect, it } from "vitest";
import {
  createLinkInputSchema,
  defaultMobileMessage,
  interpolateMobileMessage,
  limitationCopy,
  resumeSessionSchema,
  sessionProgressSchema,
  suspiciousEventSchema,
} from "./index";

describe("shared contract helpers", () => {
  it("injects username into the mobile message", () => {
    expect(interpolateMobileMessage(defaultMobileMessage, "Faizan")).toContain("Faizan");
  });

  it("keeps the limitation copy explicit", () => {
    expect(limitationCopy.toLowerCase()).toContain("cannot fully prevent screenshots");
  });

  it("accepts secure link input with storage keys", () => {
    const parsed = createLinkInputSchema.parse({
      recipientName: "Faizan",
      mobileMessageTemplate: defaultMobileMessage,
      imageDisplaySeconds: 8,
      maxUses: 1,
      autoDeleteDelaySeconds: 300,
      assets: [
        {
          id: "asset-1",
          type: "image",
          originalName: "private.png",
          mimeType: "image/png",
          durationSeconds: null,
          order: 0,
          storageKey: "storage-1.png",
        },
      ],
    });

    expect(parsed.assets[0].storageKey).toBe("storage-1.png");
  });

  it("accepts escape-key as a suspicious event", () => {
    expect(suspiciousEventSchema.parse("escape-key")).toBe("escape-key");
  });

  it("accepts session progress payloads", () => {
    const parsed = sessionProgressSchema.parse({
      sessionId: "session-123456",
      assetId: "asset-1",
      elapsedSeconds: 20,
      durationSeconds: 100,
    });

    expect(parsed.elapsedSeconds).toBe(20);
    expect(parsed.durationSeconds).toBe(100);
  });

  it("accepts resume session payloads", () => {
    expect(
      resumeSessionSchema.parse({
        sessionId: "session-123456",
      }).sessionId,
    ).toBe("session-123456");
  });
});
