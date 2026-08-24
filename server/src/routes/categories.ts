import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();

const categorySchema = z.object({
  name: z.string().min(2, "El nombre debe tener minimo 2 caracteres."),
  color: z.string().default("#f59e0b"),
  description: z.string().optional().nullable()
});

router.use(requireAuth);

router.get("/", async (_req, res) => {
  const result = await query(
    `SELECT c.*, COUNT(p.id)::int AS products_count
     FROM categories c
     LEFT JOIN products p ON p.category_id = c.id
     GROUP BY c.id
     ORDER BY c.name ASC`
  );
  return res.json(result.rows);
});

router.post("/", requirePermission("all"), async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "No se pudo crear la categoria.",
      fields: parsed.error.issues.map((issue) => issue.message)
    });
  }
  try {
    const result = await query(
      `INSERT INTO categories (name, color, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [parsed.data.name.trim(), parsed.data.color, parsed.data.description ?? null]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ message: "No se pudo crear la categoria: ya existe una categoria con ese nombre." });
    }
    return res.status(500).json({ message: "No se pudo crear la categoria por un error interno." });
  }
});

router.put("/:id", requirePermission("all"), async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const result = await query(
    `UPDATE categories SET name=$1, color=$2, description=$3
     WHERE id=$4 RETURNING *`,
    [parsed.data.name, parsed.data.color, parsed.data.description ?? null, req.params.id]
  );
  return res.json(result.rows[0]);
});

router.delete("/:id", requirePermission("all"), async (req, res) => {
  try {
    const result = await query("DELETE FROM categories WHERE id=$1 RETURNING id", [req.params.id]);
    if (!result.rows[0]) {
      return res.status(404).json({ message: "No se pudo eliminar: la categoria no existe." });
    }
    return res.status(204).send();
  } catch {
    return res.status(500).json({ message: "No se pudo eliminar la categoria por un error interno." });
  }
});

export default router;
