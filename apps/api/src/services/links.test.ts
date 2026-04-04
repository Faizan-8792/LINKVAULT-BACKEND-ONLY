import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "../utils/crypto.js";

const {
  secureLinkFindOneMock,
  viewerSessionFindOneMock,
  viewerSessionCreateMock,
  recordAuditEventMock,
} = vi.hoisted(() => ({
  secureLinkFindOneMock: vi.fn(),
  viewerSessionFindOneMock: vi.fn(),
  viewerSessionCreateMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
}));

vi.mock("../models/SecureLink.js", () => ({
  SecureLinkModel: {
    findOne: secureLinkFindOneMock,
    findById: vi.fn(),
    exists: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../models/ViewerSession.js", () => ({
  ViewerSessionModel: {
    findOne: viewerSessionFindOneMock,
    findById: vi.fn(),
    create: viewerSessionCreateMock,
  },
}));

vi.mock("./audit.js", () => ({
  recordAuditEvent: recordAuditEventMock,
}));

import { startViewerSession } from "./links.js";

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36";
const TOKEN = "token-1234567890";

function createLink() {
  return {
    _id: "link-1",
    tokenHash: hashToken(TOKEN),
    recipientName: "Saif",
    mobileMessageTemplate: "Hi {username}",
    imageDisplaySeconds: 10,
    maxUses: 1,
    usesConsumed: 0,
    status: "active",
    assets: [
      {
        assetId: "asset-1",
        type: "image",
        originalName: "secret.png",
        mimeType: "image/png",
        durationSeconds: null,
        order: 0,
        storageKey: "asset-1.png",
      },
      {
        assetId: "asset-2",
        type: "video",
        originalName: "clip.mp4",
        mimeType: "video/mp4",
        durationSeconds: 24,
        order: 1,
        storageKey: "asset-2.mp4",
      },
    ],
    save: vi.fn().mockResolvedValue(undefined),
  };
}

function createSession(overrides?: Partial<Record<string, unknown>>) {
  return {
    _id: "session-1",
    linkId: "link-1",
    fingerprint: "fingerprint-1",
    deviceType: "desktop",
    warningCount: 0,
    status: "active",
    currentAssetIndex: 1,
    completedAssets: [
      {
        assetId: "asset-1",
        openedAt: new Date("2026-04-04T10:00:00.000Z"),
        completedAt: new Date("2026-04-04T10:00:10.000Z"),
      },
    ],
    fullscreenAccepted: false,
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createRequest(fingerprint: string) {
  return {
    headers: {
      "user-agent": DESKTOP_UA,
      "x-client-fingerprint": fingerprint,
    },
  } as any;
}

function createSortedResult<T>(value: T) {
  return {
    sort: vi.fn().mockResolvedValue(value),
  };
}

function mockViewerSessionLookups(activeSession: unknown, reopenSession: unknown = null) {
  viewerSessionFindOneMock.mockImplementation((query: Record<string, unknown>) => {
    if (query.expireOnReopen) {
      return createSortedResult(reopenSession);
    }

    return activeSession;
  });
}

describe("startViewerSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    secureLinkFindOneMock.mockResolvedValue(createLink());
    viewerSessionCreateMock.mockResolvedValue({
      _id: "session-new",
      save: vi.fn().mockResolvedValue(undefined),
    });
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it("reuses the existing active session for the same browser fingerprint", async () => {
    const activeSession = createSession();
    mockViewerSessionLookups(activeSession);

    const result = await startViewerSession(TOKEN, createRequest("fingerprint-1"), true);

    expect(secureLinkFindOneMock).toHaveBeenCalledWith({ tokenHash: hashToken(TOKEN) });
    expect(result.status).toBe(200);
    if (result.status !== 200 || !("sessionId" in result.payload)) {
      throw new Error(`Expected a reused session payload, received ${result.status}`);
    }
    expect(result.payload.sessionId).toBe("session-1");
    expect(result.payload.currentAssetIndex).toBe(1);
    expect(result.payload.completedAssetIds).toEqual(["asset-1"]);
    expect(result.payload.streamTickets).toMatchObject({
      "asset-1": expect.any(String),
      "asset-2": expect.any(String),
    });
    expect(activeSession.fullscreenAccepted).toBe(true);
    expect(activeSession.save).toHaveBeenCalledTimes(1);
    expect(viewerSessionCreateMock).not.toHaveBeenCalled();
  });

  it("keeps the 409 conflict for a different browser fingerprint", async () => {
    mockViewerSessionLookups(createSession({ fingerprint: "other-browser" }));

    const result = await startViewerSession(TOKEN, createRequest("fingerprint-1"), true);

    expect(result).toEqual({
      status: 409,
      payload: { message: "A secure session is already active" },
    });
    expect(viewerSessionCreateMock).not.toHaveBeenCalled();
  });
});
