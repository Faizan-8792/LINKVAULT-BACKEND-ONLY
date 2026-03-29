import { createApp } from "./app.js";
import { startCleanupJob } from "./cleanup.js";
import { config } from "./config.js";
import { connectDatabase } from "./db.js";

async function hasHealthyApi(port: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function listenWithFallback(startPort: number, attempts = 10) {
  const app = createApp();

  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset;

    try {
      await new Promise<void>((resolve, reject) => {
        const server = app.listen(port, () => {
          console.log(`API listening on http://localhost:${port}`);
          resolve();
        });

        server.once("error", (error) => {
          if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
            server.close();
          }
          reject(error);
        });
      });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || offset === attempts - 1) {
        throw error;
      }
      if (await hasHealthyApi(port)) {
        console.log(`API already running on http://localhost:${port}`);
        return;
      }
      console.warn(`Port ${port} is already in use, trying ${port + 1}...`);
    }
  }
}

async function bootstrap() {
  await connectDatabase();
  startCleanupJob();
  await listenWithFallback(config.port);
}

void bootstrap();
