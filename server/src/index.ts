import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import accountingRoutes from "./routes/accounting.js";
import authRoutes from "./routes/auth.js";
import categoriesRoutes from "./routes/categories.js";
import productsRoutes from "./routes/products.js";
import salesRoutes from "./routes/sales.js";
import shiftsRoutes from "./routes/shifts.js";
import usersRoutes from "./routes/users.js";

const app = express();
const uploadsDir = path.resolve("uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.clientOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origen CORS no permitido: ${origin}`));
    },
    credentials: true
  })
);
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));

app.get("/api/health", (_req, res) => res.json({ ok: true, app: "PoLa Causa" }));
app.use("/api/auth", authRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/accounting", accountingRoutes);
app.use("/api/shifts", shiftsRoutes);

async function ensureDatabaseSchema() {
  const schemaPath = path.resolve("src/db/schema.sql");
  const sql = await fsp.readFile(schemaPath, "utf8");
  await pool.query(sql);
}

ensureDatabaseSchema()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`PoLa Causa API running on http://localhost:${config.port}`);
    });
  })
  .catch((error) => {
    console.error("[PoLa Causa] No se pudo preparar la base de datos:", error);
    process.exit(1);
  });
