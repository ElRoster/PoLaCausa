import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { uploadProductImage } from "../services/images.js";

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype.startsWith("image/"));
  },
  limits: { fileSize: 4 * 1024 * 1024 }
});

const router = Router();

const productSchema = z.object({
  name: z.string().min(2),
  sku: z.string().min(2),
  description: z.string().optional().nullable(),
  category_id: z.string().uuid().optional().nullable(),
  price: z.coerce.number().nonnegative(),
  employee_discount_percent: z.coerce.number().min(0).max(100).default(0),
  cost: z.coerce.number().nonnegative().default(0),
  stock: z.coerce.number().int().default(0),
  min_stock: z.coerce.number().int().default(0),
  abv: z.coerce.number().nonnegative().default(0),
  origin: z.string().optional().nullable(),
  is_active: z.coerce.boolean().default(true)
});

router.use(requireAuth);

router.get("/", async (req, res) => {
  const search = String(req.query.search ?? "");
  const category = String(req.query.category ?? "");
  const stockMode = String(req.query.stockMode ?? "");
  const params: unknown[] = [];
  const where = ["p.is_active = TRUE"];

  if (search) {
    params.push(`%${search}%`);
    where.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
  }
  if (category) {
    params.push(category);
    where.push(`p.category_id = $${params.length}`);
  }
  if (stockMode === "low") where.push("p.stock <= p.min_stock");
  if (stockMode === "out") where.push("p.stock <= 0");

  const result = await query(
    `SELECT p.*, c.name AS category_name, c.color AS category_color
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${where.join(" AND ")}
     ORDER BY p.updated_at DESC`,
    params
  );
  return res.json(result.rows);
});

router.post(
  "/",
  requirePermission("all"),
  upload.single("image"),
  async (req, res) => {
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error);
    const imageUrl = await uploadProductImage(req.file);
    const p = parsed.data;
    const result = await query(
      `INSERT INTO products
       (name, sku, description, category_id, price, employee_discount_percent, cost, stock, min_stock, abv, origin, image_url, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        p.name,
        p.sku,
        p.description ?? null,
        p.category_id || null,
        p.price,
        p.employee_discount_percent,
        p.cost,
        p.stock,
        p.min_stock,
        p.abv,
        p.origin ?? null,
        imageUrl,
        p.is_active
      ]
    );
    return res.status(201).json(result.rows[0]);
  }
);

router.put(
  "/:id",
  requirePermission("all"),
  upload.single("image"),
  async (req, res) => {
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error);
    const current = await query<{ image_url: string | null }>(
      "SELECT image_url FROM products WHERE id=$1",
      [req.params.id]
    );
    const imageUrl = req.file ? await uploadProductImage(req.file) : current.rows[0]?.image_url;
    const p = parsed.data;
    const result = await query(
      `UPDATE products SET
       name=$1, sku=$2, description=$3, category_id=$4, price=$5, employee_discount_percent=$6, cost=$7,
       stock=$8, min_stock=$9, abv=$10, origin=$11, image_url=$12, is_active=$13, updated_at=NOW()
       WHERE id=$14 RETURNING *`,
      [
        p.name,
        p.sku,
        p.description ?? null,
        p.category_id || null,
        p.price,
        p.employee_discount_percent,
        p.cost,
        p.stock,
        p.min_stock,
        p.abv,
        p.origin ?? null,
        imageUrl,
        p.is_active,
        req.params.id
      ]
    );
    return res.json(result.rows[0]);
  }
);

router.delete("/:id", requirePermission("all"), async (req, res) => {
  await query("UPDATE products SET is_active = FALSE WHERE id=$1", [req.params.id]);
  return res.status(204).send();
});

export default router;
