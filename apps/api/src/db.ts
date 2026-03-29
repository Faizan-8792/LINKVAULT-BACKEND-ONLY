import mongoose from "mongoose";
import dns from "node:dns";
import { config } from "./config.js";

let isConnected = false;
let lastDatabaseError: string | null = null;
let connectInFlight: Promise<mongoose.Connection | null> | null = null;
let listenersBound = false;

function bindConnectionListeners() {
  if (listenersBound) {
    return;
  }

  listenersBound = true;
  mongoose.connection.on("connected", () => {
    isConnected = true;
    lastDatabaseError = null;
  });
  mongoose.connection.on("disconnected", () => {
    isConnected = false;
    if (!lastDatabaseError) {
      lastDatabaseError = "MongoDB disconnected.";
    }
  });
  mongoose.connection.on("error", (error) => {
    isConnected = false;
    lastDatabaseError = error instanceof Error ? error.message : "MongoDB connection error.";
  });
}

function shouldRetryWithPublicDns(uri: string, error: unknown) {
  if (!uri.startsWith("mongodb+srv://")) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("querySrv") ||
    message.includes("ENOTFOUND") ||
    message.includes("ETIMEOUT") ||
    message.includes("ECONNREFUSED")
  );
}

async function connectWithFallback(uri: string) {
  try {
    return await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
    });
  } catch (firstError) {
    if (!shouldRetryWithPublicDns(uri, firstError)) {
      throw firstError;
    }

    // Some networks block SRV lookups via the default resolver; retry with public DNS.
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
    return mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
    });
  }
}

export async function connectDatabase() {
  if (isConnected) {
    return mongoose.connection;
  }

  if (connectInFlight) {
    return connectInFlight;
  }

  connectInFlight = (async () => {
    if (!config.mongodbConfigured) {
      lastDatabaseError =
        "MongoDB is not configured. Add a real MONGODB_URI in apps/api/.env to enable auth, uploads, and secure links.";
      console.warn(lastDatabaseError);
      return null;
    }

    try {
      bindConnectionListeners();
      await connectWithFallback(config.mongodbUri);
      isConnected = true;
      lastDatabaseError = null;
      return mongoose.connection;
    } catch (error) {
      isConnected = false;
      lastDatabaseError =
        error instanceof Error ? error.message : "MongoDB connection failed for an unknown reason.";
      console.error(`MongoDB connection failed: ${lastDatabaseError}`);
      return null;
    } finally {
      connectInFlight = null;
    }
  })();

  return connectInFlight;
}

export function isDatabaseReady() {
  return isConnected;
}

export function getDatabaseStatus() {
  return {
    configured: config.mongodbConfigured,
    ready: isConnected,
    error: lastDatabaseError,
  };
}
