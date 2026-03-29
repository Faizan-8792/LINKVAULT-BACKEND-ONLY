import mongoose, { Schema } from "mongoose";

const auditEventSchema = new Schema(
  {
    linkId: { type: Schema.Types.ObjectId, ref: "SecureLink", index: true, required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: "ViewerSession", default: null, index: true },
    type: { type: String, required: true },
    message: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const AuditEventModel =
  mongoose.models.AuditEvent || mongoose.model("AuditEvent", auditEventSchema);
