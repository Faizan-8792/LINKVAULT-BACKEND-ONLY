import mongoose, { Schema } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["approved", "pending", "rejected"],
      default: "pending",
    },
    approvedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    adminSessionId: { type: String, default: null },
    adminFingerprintHash: { type: String, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type UserDocument = mongoose.InferSchemaType<typeof userSchema> & mongoose.Document;

export const UserModel = mongoose.models.User || mongoose.model("User", userSchema);
