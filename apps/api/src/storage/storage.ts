import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Express } from "express";
import { config } from "../config.js";

export type StoredUpload = {
  assetId: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  size: number;
};

export interface StorageProvider {
  save(file: Express.Multer.File): Promise<StoredUpload>;
  remove(storageKey: string): Promise<void>;
  stat(storageKey: string): Promise<{ size: number; path: string }>;
}

class LocalStorageProvider implements StorageProvider {
  constructor(private readonly root: string) {}

  async ensureRoot() {
    await fs.mkdir(this.root, { recursive: true });
  }

  async save(file: Express.Multer.File) {
    await this.ensureRoot();
    const assetId = crypto.randomUUID();
    const ext = path.extname(file.originalname);
    const storageKey = `${assetId}${ext}`;
    const target = path.join(this.root, storageKey);
    await fs.rename(file.path, target);

    return {
      assetId,
      storageKey,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  async remove(storageKey: string) {
    const target = path.join(this.root, storageKey);
    if (fssync.existsSync(target)) {
      await fs.rm(target, { force: true });
    }
  }

  async stat(storageKey: string) {
    const target = path.join(this.root, storageKey);
    const stats = await fs.stat(target);
    return { size: stats.size, path: target };
  }
}

export const storageProvider: StorageProvider = new LocalStorageProvider(config.uploadRoot);
