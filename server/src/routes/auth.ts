import bcrypt from "bcryptjs";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import type { AuthedRequest, AuthUser } from "../types.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().min(2),
  password: z.string().min(8)
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Credenciales invalidas" });
  }

  const result = await query<{
    id: string;
    name: string;
    email: string;
    password_hash: string | null;
    role: string;
    permissions: string[];
  }>(
    `SELECT u.id, u.name, u.email, u.password_hash, r.name AS role, r.permissions
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.email = $1 AND u.is_active = TRUE`,
    [parsed.data.email.toLowerCase()]
  );

  const dbUser = result.rows[0];
  if (dbUser && !dbUser.password_hash) {
    return res.status(403).json({ message: "Tu usuario no tiene contraseña asignada. Solicita al administrador que edite tu cuenta." });
  }
  if (!dbUser || !dbUser.password_hash || !(await bcrypt.compare(parsed.data.password, dbUser.password_hash))) {
    return res.status(401).json({ message: "Usuario o password incorrectos" });
  }

  const user: AuthUser = {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    role: dbUser.role,
    permissions: dbUser.permissions ?? []
  };

  const token = jwt.sign(user, config.jwtSecret, { expiresIn: "10h" });
  return res.json({ token, user });
});

router.get("/me", requireAuth, (req: AuthedRequest, res) => {
  return res.json({ user: req.user });
});

export default router;
