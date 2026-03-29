import { AuditEventModel } from "../models/AuditEvent.js";

export async function recordAuditEvent(input: {
  linkId: string;
  sessionId?: string | null;
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  await AuditEventModel.create({
    linkId: input.linkId,
    sessionId: input.sessionId ?? null,
    type: input.type,
    message: input.message,
    metadata: input.metadata ?? {},
  });
}
