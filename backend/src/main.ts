import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const productionEnvironment = process.env.NODE_ENV === "production";
if (!productionEnvironment) {
  dotenv.config();
}

const { createApp } = await import("./server.js");

const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be configured before starting the backend");
}

try {
  const parsedDatabaseUrl = new URL(databaseUrl);
  if (!["postgresql:", "postgres:"].includes(parsedDatabaseUrl.protocol) || !parsedDatabaseUrl.hostname || !parsedDatabaseUrl.pathname.slice(1)) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
  }
} catch (error) {
  throw new Error(error instanceof Error ? error.message : "DATABASE_URL must be a valid PostgreSQL connection URL");
}

const jwtSecret = String(process.env.JWT_SECRET ?? "").trim();
if (!jwtSecret) {
  throw new Error("JWT_SECRET must be configured before starting the backend");
}

const prisma = new PrismaClient();
const app = createApp({ prisma, jwtSecret });
const port = Number(process.env.PORT || 3001);
const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "uploads");

app.listen(port, async () => {
  await mkdir(uploadsDir, { recursive: true });
  console.log(`Shelby MySQL backend listening on http://localhost:${port}`);
});
