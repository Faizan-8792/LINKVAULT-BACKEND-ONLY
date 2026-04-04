import mongoose, { Schema } from "mongoose";

const completedAssetSchema = new Schema(
  {
    assetId: { type: String, required: true },
    openedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { _id: false },
);

const viewerSessionSchema = new Schema(
  {
    linkId: { type: Schema.Types.ObjectId, ref: "SecureLink", required: true, index: true },
    deviceType: {
      type: String,
      enum: ["desktop", "mobile", "tablet", "unknown"],
      required: true,
    },
    fingerprint: { type: String, default: null },
    warningCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["active", "warning", "destroyed", "completed"],
      default: "active",
    },
    currentAssetIndex: { type: Number, default: 0 },
    currentAssetElapsedSeconds: { type: Number, default: 0 },
    completedAssets: { type: [completedAssetSchema], default: [] },
    fullscreenAccepted: { type: Boolean, default: false },
    escapeCount: { type: Number, default: 0 },
    resumeUsed: { type: Boolean, default: false },
    pauseAttemptCount: { type: Number, default: 0 },
    expireOnReopen: { type: Boolean, default: false },
    pauseReason: { type: String, default: null },
    destroyReason: { type: String, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

viewerSessionSchema.index({ linkId: 1, status: 1 });

export type ViewerSessionDocument = mongoose.InferSchemaType<typeof viewerSessionSchema> &
  mongoose.Document;

export const ViewerSessionModel =
  mongoose.models.ViewerSession || mongoose.model("ViewerSession", viewerSessionSchema);
