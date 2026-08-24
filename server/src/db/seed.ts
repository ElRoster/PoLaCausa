import bcrypt from "bcryptjs";
import { pool } from "./pool.js";

async function seed() {
  const adminRole = await pool.query(
    `INSERT INTO roles (name, permissions)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET permissions = EXCLUDED.permissions
     RETURNING id`,
    ["Administrador", ["all"]]
  );

  await pool.query(
    `INSERT INTO roles (name, permissions)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET permissions = EXCLUDED.permissions`,
    ["Vendedor", ["sales:read", "sales:create", "products:read", "shifts:manage", "accounting:limited"]]
  );

  const hash = await bcrypt.hash("PolaCausa2026!", 12);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role_id, employee_credit)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO NOTHING`,
    ["Admin PoLa", "admin@polacausa.com", hash, adminRole.rows[0].id, 250000]
  );

  const categories = [
    ["Artesanales", "#f59e0b", "Cervezas locales y ediciones especiales"],
    ["Importadas", "#0ea5e9", "Latas y botellas internacionales"],
    ["Sin alcohol", "#22c55e", "Opciones cero o bajas en alcohol"],
    ["Snacks", "#ef4444", "Acompanantes para la venta cruzada"]
  ];

  for (const category of categories) {
    await pool.query(
      `INSERT INTO categories (name, color, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO NOTHING`,
      category
    );
  }

  await pool.end();
  console.log("Database seeded");
}

seed().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
