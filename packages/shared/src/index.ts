import { z } from "zod";

export const assetTypeSchema = z.enum(["image", "video", "audio"]);
export type AssetType = z.infer<typeof assetTypeSchema>;

export const userStatusSchema = z.enum(["approved", "pending", "rejected"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const linkStatusSchema = z.enum([
  "draft",
  "active",
  "consumed",
  "expired",
  "destroyed",
]);
export type LinkStatus = z.infer<typeof linkStatusSchema>;

export const deviceTypeSchema = z.enum(["desktop", "mobile", "tablet", "unknown"]);
export type DeviceType = z.infer<typeof deviceTypeSchema>;

export const suspiciousEventSchema = z.enum([
  "printscreen",
  "devtools-shortcut",
  "window-blur",
  "visibility-hidden",
  "context-menu",
  "copy-attempt",
  "fullscreen-exit",
  "pause-attempt",
  "button-tap-attempt",
  "manual-destroy",
]);
export type SuspiciousEventType = z.infer<typeof suspiciousEventSchema>;

export const secureAssetSchema = z.object({
  id: z.string(),
  type: assetTypeSchema,
  originalName: z.string(),
  mimeType: z.string(),
  durationSeconds: z.number().nullable(),
  order: z.number(),
  storageKey: z.string().optional(),
});
export type SecureAsset = z.infer<typeof secureAssetSchema>;

export const createLinkInputSchema = z.object({
  recipientName: z.string().trim().min(1).max(120),
  mobileMessageTemplate: z.string().trim().min(1).max(240),
  imageDisplaySeconds: z.number().int().min(1).max(120),
  maxUses: z.number().int().min(1).max(25),
  autoDeleteDelaySeconds: z.number().int().min(60).max(300),
  assets: z.array(secureAssetSchema).min(1).max(50),
});
export type CreateLinkInput = z.infer<typeof createLinkInputSchema>;

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(2).max(60),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const validateLinkSchema = z.object({
  token: z.string().min(12),
});
export type ValidateLinkInput = z.infer<typeof validateLinkSchema>;

export const startSessionSchema = z.object({
  token: z.string().min(12),
  fullscreenAccepted: z.boolean().optional(),
});
export type StartSessionInput = z.infer<typeof startSessionSchema>;

export const assetProgressSchema = z.object({
  sessionId: z.string().min(12),
  assetId: z.string().min(1),
  event: z.enum(["opened", "completed"]),
});
export type AssetProgressInput = z.infer<typeof assetProgressSchema>;

export const suspiciousReportSchema = z.object({
  sessionId: z.string().min(12),
  event: suspiciousEventSchema,
});
export type SuspiciousReportInput = z.infer<typeof suspiciousReportSchema>;

export const consumeContentSchema = z.object({
  sessionId: z.string().min(12),
});
export type ConsumeContentInput = z.infer<typeof consumeContentSchema>;

export const destroyLinkSchema = z.object({
  sessionId: z.string().min(12).optional(),
  token: z.string().min(12).optional(),
  reason: z.string().trim().min(3).max(180),
});
export type DestroyLinkInput = z.infer<typeof destroyLinkSchema>;

export type PublicLinkPayload = {
  id: string;
  recipientName: string;
  mobileMessage: string;
  imageDisplaySeconds: number;
  maxUses: number;
  usesConsumed: number;
  remainingUses: number;
  status: LinkStatus;
  assets: SecureAsset[];
  warning: string;
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  isApproved: boolean;
  createdAt: string;
};

export type SessionAssetState = {
  assetId: string;
  completed: boolean;
  openedAt?: string;
  completedAt?: string;
};

export type PublicSessionPayload = {
  sessionId: string;
  deviceType: DeviceType;
  warningCount: number;
  status: "active" | "warning" | "destroyed" | "completed";
  currentAssetIndex: number;
  assets: SecureAsset[];
  completedAssetIds: string[];
};

export const limitationCopy =
  "This system cannot fully prevent screenshots or recordings in web browsers. It only discourages and reacts to suspicious behavior.";

export const defaultMobileMessage =
  "Hi {username}, open this link on desktop to view full content";

export function interpolateMobileMessage(template: string, username: string) {
  return template.replaceAll("{username}", username || "there");
}

export function formatLinkStatus(status: LinkStatus) {
  return status[0].toUpperCase() + status.slice(1);
}
