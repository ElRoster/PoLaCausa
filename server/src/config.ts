import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(dirname, "../.env") });

const defaultClientOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://polacausa:polacausa@127.0.0.1:55432/polacausa",
  jwtSecret: process.env.JWT_SECRET ?? "dev_secret_change_me",
  clientOrigins: (process.env.CLIENT_URL ?? defaultClientOrigins.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
};
