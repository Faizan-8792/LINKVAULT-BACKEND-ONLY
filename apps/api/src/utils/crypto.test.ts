import { describe, expect, it } from "vitest";
import { hashToken, signStreamTicket, verifyStreamTicket } from "./crypto.js";

describe("crypto helpers", () => {
  it("hashes tokens deterministically", () => {
    expect(hashToken("token-123")).toBe(hashToken("token-123"));
  });

  it("signs and verifies stream tickets", () => {
    const ticket = signStreamTicket({
      sessionId: "session-1",
      assetId: "asset-1",
      expiresAt: Date.now() + 5_000,
    });

    const decoded = verifyStreamTicket(ticket);
    expect(decoded.sessionId).toBe("session-1");
    expect(decoded.assetId).toBe("asset-1");
  });
});
