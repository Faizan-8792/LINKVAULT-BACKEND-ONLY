import cron from "node-cron";
import { isDatabaseReady } from "./db.js";
import { removeExpiredLinksAndMedia } from "./services/links.js";

export function startCleanupJob() {
  cron.schedule("*/1 * * * *", () => {
    if (!isDatabaseReady()) {
      return;
    }
    void removeExpiredLinksAndMedia();
  });
}
