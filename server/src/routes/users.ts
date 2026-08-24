import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";

const router = Router();

const userSchema = z.object({
  name: z.string().min(2, "El nombre debe tener minimo 2 caracteres."),
  email: z.string().min(2, "El usuario de acceso debe tener minimo 2 caracteres."),
  password: z.string().min(8, "El password debe tener minimo 8 caracteres.").optional(),
  role_id: z.string().uuid("Selecciona un rol valido."),
  employee_credit: z.coerce.number().default(0),
  hourly_rate: z.coerce.number().nonnegative().default(0),
  is_active: z.coerce.boolean().default(true)
});

router.use(requireAuth, requirePermission("all"));

router.get("/roles", async (_req, res) => {
  const result = await query("SELECT * FROM roles ORDER BY name");
  return res.json(result.rows);
});

router.get("/", async (_req, res) => {
  const result = await query(
    `SELECT u.id, u.name, u.email, u.employee_credit, u.hourly_rate, u.is_active, u.created_at,
            r.id AS role_id, r.name AS role
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = TRUE
     ORDER BY u.created_at DESC`
  );
  return res.json(result.rows);
});

router.get("/:id", async (req, res) => {
  const result = await query(
    `SELECT u.id, u.name, u.email, u.employee_credit, u.hourly_rate, u.is_active, u.created_at,
            r.id AS role_id, r.name AS role
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id=$1`,
    [req.params.id]
  );
  if (!result.rows[0]) {
    return res.status(404).json({ message: "No se encontro el usuario solicitado." });
  }
  return res.json(result.rows[0]);
});

router.post("/", async (req, res) => {
  const parsed = userSchema.extend({ password: z.string().min(8, "El password debe tener minimo 8 caracteres.") }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "No se pudo crear el usuario.",
      fields: parsed.error.issues.map((issue) => issue.message)
    });
  }
  try {
    const role = await query("SELECT id FROM roles WHERE id=$1", [parsed.data.role_id]);
    if (!role.rows[0]) {
      return res.status(400).json({ message: "No se pudo crear el usuario: el rol seleccionado no existe." });
    }
    const hash = await bcrypt.hash(parsed.data.password, 12);
    const result = await query<{ id: string; name: string; email: string; employee_credit: string; hourly_rate: string; is_active: boolean; created_at: string }>(
      `INSERT INTO users (name, email, password_hash, role_id, employee_credit, hourly_rate, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, email, employee_credit, hourly_rate, is_active, created_at`,
      [
        parsed.data.name.trim(),
        parsed.data.email.toLowerCase().trim(),
        hash,
        parsed.data.role_id,
        parsed.data.employee_credit,
        parsed.data.hourly_rate,
        parsed.data.is_active
      ]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
    return res.status(409).json({ message: "No se pudo crear el usuario: ya existe un usuario con ese acceso." });
    }
    return res.status(500).json({ message: "No se pudo crear el usuario por un error interno." });
  }
});

router.put("/:id", async (req, res) => {
  const parsed = userSchema.omit({ password: true }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "No se pudo editar el usuario.",
      fields: parsed.error.issues.map((issue) => issue.message)
    });
  }
  try {
    const result = await query(
      `UPDATE users SET name=$1, email=$2, role_id=$3, employee_credit=$4, hourly_rate=$5, is_active=$6
       WHERE id=$7
       RETURNING id`,
      [
        parsed.data.name.trim(),
        parsed.data.email.toLowerCase().trim(),
        parsed.data.role_id,
        parsed.data.employee_credit,
        parsed.data.hourly_rate,
        parsed.data.is_active,
        req.params.id
      ]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: "No se pudo editar: el usuario no existe." });
    }
    return res.json({ ok: true });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ message: "No se pudo editar el usuario: ya existe otro usuario con ese acceso." });
    }
    return res.status(500).json({ message: "No se pudo editar el usuario por un error interno." });
  }
});

router.patch("/:id/password", async (req, res) => {
  const parsed = z
    .object({
      password: z.string().min(8, "El password debe tener minimo 8 caracteres.")
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "No se pudo cambiar la contraseña.",
      fields: parsed.error.issues.map((issue) => issue.message)
    });
  }

  const hash = await bcrypt.hash(parsed.data.password, 12);
  const result = await query("UPDATE users SET password_hash=$1 WHERE id=$2 RETURNING id", [
    hash,
    req.params.id
  ]);
  if (!result.rows[0]) {
    return res.status(404).json({ message: "No se pudo cambiar la contraseña: el usuario no existe." });
  }
  return res.json({ ok: true });
});

router.delete("/:id", async (req: AuthedRequest, res) => {
  if (req.params.id === req.user?.id) {
    return res.status(400).json({ message: "No puedes eliminar tu propio usuario mientras tienes la sesion activa." });
  }
  const result = await query(
    "UPDATE users SET is_active = FALSE WHERE id=$1 RETURNING id",
    [req.params.id]
  );
  if (!result.rows[0]) {
    return res.status(404).json({ message: "No se pudo eliminar: el usuario no existe." });
  }
  return res.status(204).send();
});

export default router;
