import mongoose, { Schema } from "mongoose";

const assetSchema = new Schema(
  {
    assetId: { type: String, required: true },
    type: { type: String, enum: ["image", "video", "audio"], required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    storageKey: { type: String, required: true },
    durationSeconds: { type: Number, default: null },
    order: { type: Number, required: true },
  },
  { _id: false },
);

const secureLinkSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    recipientName: { type: String, required: true },
    mobileMessageTemplate: { type: String, required: true },
    imageDisplaySeconds: { type: Number, required: true },
    maxUses: { type: Number, required: true, default: 1 },
    usesConsumed: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ["draft", "active", "consumed", "expired", "destroyed"],
      default: "active",
      index: true,
    },
    assets: { type: [assetSchema], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    replacementParentId: { type: Schema.Types.ObjectId, ref: "SecureLink", default: null, index: true },
    replacementChildId: { type: Schema.Types.ObjectId, ref: "SecureLink", default: null, index: true },
    lastDeviceType: { type: String, default: null },
    mobileOpenCount: { type: Number, default: 0 },
    desktopOpenCount: { type: Number, default: 0 },
    autoDeleteDelaySeconds: { type: Number, default: 300 },
    cleanupAt: { type: Date, default: null, index: true },
    expiredAt: { type: Date, default: null },
    warningMessage: {
      type: String,
      default:
        "This system cannot fully prevent screenshots or recordings in web browsers. It only discourages and reacts to suspicious behavior.",
    },
  },
  { timestamps: true },
);

export type SecureLinkDocument = mongoose.InferSchemaType<typeof secureLinkSchema> & mongoose.Document;

export const SecureLinkModel =
  mongoose.models.SecureLink || mongoose.model("SecureLink", secureLinkSchema);
