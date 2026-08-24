import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";

const router = Router();

const saleSchema = z.object({
  customer_name: z.string().optional().nullable(),
  discount: z.coerce.number().default(0),
  adjustment: z.coerce.number().default(0),
  payment_method: z.enum(["cash", "transfer", "flexible", "credit"]).default("cash"),
  cash_received: z.coerce.number().optional().nullable(),
  transfer_received: z.coerce.number().optional().nullable(),
  note: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.coerce.number().int().positive()
      })
    )
    .min(1)
});

router.use(requireAuth);

function periodWhere(period: string) {
  const localNow = "NOW() AT TIME ZONE 'America/Bogota'";
  if (period === "day") {
    return `s.created_at >= (date_trunc('day', ${localNow}) AT TIME ZONE 'America/Bogota') AND s.created_at < ((date_trunc('day', ${localNow}) + interval '1 day') AT TIME ZONE 'America/Bogota')`;
  }
  if (period === "week") {
    return `s.created_at >= (date_trunc('week', ${localNow}) AT TIME ZONE 'America/Bogota') AND s.created_at < ((date_trunc('week', ${localNow}) + interval '1 week') AT TIME ZONE 'America/Bogota')`;
  }
  if (period === "month") {
    return `s.created_at >= (date_trunc('month', ${localNow}) AT TIME ZONE 'America/Bogota') AND s.created_at < ((date_trunc('month', ${localNow}) + interval '1 month') AT TIME ZONE 'America/Bogota')`;
  }
  return "TRUE";
}

router.get("/", async (req, res) => {
  const period = String(req.query.period ?? "all");
  const result = await pool.query(
    `SELECT s.*, u.name AS user_name
     FROM sales s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE ${periodWhere(period)}
     ORDER BY s.created_at DESC
     LIMIT 100`
  );
  return res.json(result.rows);
});

router.post("/", async (req: AuthedRequest, res) => {
  const parsed = saleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = parsed.data.items.map((item) => item.product_id);
    const products = await client.query<{
      id: string;
      price: string;
      employee_discount_percent: string;
      cost: string;
      stock: number;
    }>("SELECT id, price, employee_discount_percent, cost, stock FROM products WHERE id = ANY($1::uuid[])", [ids]);

    const productMap = new Map(products.rows.map((product) => [product.id, product]));
    let subtotal = 0;

    for (const item of parsed.data.items) {
      const product = productMap.get(item.product_id);
      if (!product) throw new Error("Producto no encontrado");
      if (product.stock < item.quantity) throw new Error("Stock insuficiente");
      const unitPrice =
        parsed.data.payment_method === "credit"
          ? Number(product.price) * (1 - Number(product.employee_discount_percent ?? 0) / 100)
          : Number(product.price);
      subtotal += unitPrice * item.quantity;
    }

    const total = subtotal - parsed.data.discount + parsed.data.adjustment;
    if (total <= 0) throw new Error("El total de la venta debe ser mayor a 0");
    if (parsed.data.payment_method === "credit" && req.user?.permissions?.includes("all")) {
      throw new Error("El credito solo aplica para consumo de empleados");
    }

    const cashReceived =
      parsed.data.payment_method === "cash" || parsed.data.payment_method === "flexible"
        ? Number(parsed.data.cash_received ?? 0)
        : null;
    const transferReceived =
      parsed.data.payment_method === "transfer" || parsed.data.payment_method === "flexible"
        ? Number(parsed.data.transfer_received ?? 0)
        : null;

    if (cashReceived !== null && cashReceived < 0) throw new Error("El efectivo recibido no puede ser negativo");
    if (transferReceived !== null && transferReceived < 0) throw new Error("El valor transferido no puede ser negativo");

    if (parsed.data.payment_method === "cash" && Number(cashReceived) < total) {
      throw new Error("El efectivo recibido no alcanza para cubrir el total de la venta");
    }
    if (parsed.data.payment_method === "transfer" && Number(transferReceived) < total) {
      throw new Error("La transferencia no alcanza para cubrir el total de la venta");
    }
    if (parsed.data.payment_method === "transfer" && Number(transferReceived) > total) {
      throw new Error("La transferencia no puede superar el total de la venta");
    }
    if (parsed.data.payment_method === "flexible" && Number(transferReceived) > total) {
      throw new Error("En pago flexible, la transferencia no puede superar el total de la venta");
    }
    if (parsed.data.payment_method === "flexible" && Number(cashReceived) + Number(transferReceived) < total) {
      throw new Error("La suma de efectivo y transferencia no alcanza para cubrir el total de la venta");
    }

    const amountCoveredBeforeCash = parsed.data.payment_method === "flexible" ? Number(transferReceived) : 0;
    const cashNeeded = Math.max(total - amountCoveredBeforeCash, 0);
    const changeAmount = cashReceived === null ? 0 : Math.max(cashReceived - cashNeeded, 0);

    const sale = await client.query<{ id: string }>(
      `INSERT INTO sales
       (user_id, customer_name, subtotal, discount, adjustment, total, payment_method, cash_received, transfer_received, change_amount, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        req.user?.id,
        parsed.data.customer_name ?? null,
        subtotal,
        parsed.data.discount,
        parsed.data.adjustment,
        total,
        parsed.data.payment_method,
        cashReceived,
        transferReceived,
        changeAmount,
        parsed.data.note ?? null
      ]
    );

    for (const item of parsed.data.items) {
      const product = productMap.get(item.product_id)!;
      const unitPrice =
        parsed.data.payment_method === "credit"
          ? Number(product.price) * (1 - Number(product.employee_discount_percent ?? 0) / 100)
          : Number(product.price);
      const lineTotal = unitPrice * item.quantity;
      await client.query(
        `INSERT INTO sale_items
         (sale_id, product_id, quantity, unit_price, unit_cost, total)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [sale.rows[0].id, item.product_id, item.quantity, unitPrice, product.cost, lineTotal]
      );
      await client.query("UPDATE products SET stock = stock - $1 WHERE id=$2", [
        item.quantity,
        item.product_id
      ]);
    }

    if (parsed.data.payment_method === "credit") {
      await client.query(
        `INSERT INTO employee_credits (sale_id, user_id, amount)
         VALUES ($1,$2,$3)`,
        [sale.rows[0].id, req.user?.id, total]
      );
    }

    await client.query("COMMIT");
    return res.status(201).json({
      id: sale.rows[0].id,
      total,
      cash_received: cashReceived,
      transfer_received: transferReceived,
      change_amount: changeAmount
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(400).json({ message: (error as Error).message });
  } finally {
    client.release();
  }
});

export default router;
