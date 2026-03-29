import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

function loadEnv() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "apps/api/.env"),
    path.resolve(moduleDir, ".env"),
    path.resolve(moduleDir, "../.env"),
    path.resolve(moduleDir, "../../apps/api/.env"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
  }

  dotenv.config();
}

loadEnv();

const defaultClientOrigin = "https://livevault.live";
const defaultClientAliasOrigin = "https://vaultlive.live";
const defaultViewerOrigin = "https://share.livevault.live";
const defaultLocalOrigin = "http://localhost:5173";

function optional(name: string, fallback?: string) {
  return process.env[name] ?? fallback ?? "";
}

function normalizeOrigin(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

function parseAllowedOrigins() {
  const fromClientUrls = optional("CLIENT_URLS")
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter(Boolean);

  const fallbackClientUrl = normalizeOrigin(optional("CLIENT_URL", defaultClientOrigin));
  const origins = new Set<string>([
    defaultClientOrigin,
    defaultClientAliasOrigin,
    defaultViewerOrigin,
    defaultLocalOrigin,
    ...fromClientUrls,
    fallbackClientUrl,
  ]);

  return [...origins];
}

function normalizeMongoUri(uri: string) {
  const value = uri.trim();
  // Accept the common Atlas copy/paste style where password is still wrapped in angle brackets.
  return value.replace(
    /(mongodb(?:\+srv)?:\/\/[^:/?#]+:)\<([^>]+)\>(@)/i,
    "$1$2$3",
  );
}

const rawMongodbUri = optional("MONGODB_URI");
const mongodbUri = normalizeMongoUri(rawMongodbUri);
const mongodbConfigured =
  Boolean(mongodbUri) &&
  !rawMongodbUri.includes("<db_password>") &&
  !mongodbUri.includes("test-mongodb_uri");

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  mongodbUri,
  mongodbConfigured,
  jwtSecret:
    optional("JWT_SECRET") || (process.env.NODE_ENV === "test" ? "test-jwt-secret" : "change-me"),
  clientUrl: normalizeOrigin(optional("CLIENT_URL", defaultClientOrigin)),
  viewerUrl: normalizeOrigin(optional("VIEWER_URL", defaultViewerOrigin)),
  allowedOrigins: parseAllowedOrigins(),
  uploadRoot: path.resolve(process.cwd(), process.env.UPLOAD_ROOT ?? "uploads"),
  streamTokenSecret:
    optional("STREAM_TOKEN_SECRET") ||
    (process.env.NODE_ENV === "test" ? "test-stream-secret" : "change-me-too"),
};
