import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { config } from "./config";
import { prisma } from "./db";
import { createRouter } from "./routes";
import { registerSocket } from "./socket";

async function bootstrap() {
  const app = express();
  app.use(cors({ origin: config.clientUrl, credentials: true }));
  app.use(express.json());
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", createRouter());

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: config.clientUrl,
      credentials: true
    }
  });

  registerSocket(io);

  httpServer.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running on http://localhost:${config.port}`);
  });
}

void bootstrap();

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
