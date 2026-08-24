import { Router } from "express";
import type { NextFunction, Response } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";

const router = Router();

router.use(requireAuth);

function canUseLimitedAccounting(req: AuthedRequest) {
  const permissions = req.user?.permissions ?? [];
  return permissions.includes("all") || permissions.includes("accounting:limited");
}

function requireLimitedAccounting(req: AuthedRequest, res: Response, next: NextFunction) {
  if (canUseLimitedAccounting(req)) return next();
  return res.status(403).json({ message: "Permisos insuficientes" });
}

const expenseTypeSchema = z.object({
  name: z.string().min(2, "El nombre debe tener minimo 2 caracteres."),
  color: z.string().default("#38bdf8"),
  description: z.string().optional().nullable()
});

function periodWhere(alias: string, period: string, column = "created_at") {
  const field = `${alias}.${column}`;
  const localNow = "NOW() AT TIME ZONE 'America/Bogota'";
  if (period === "day") {
    return `${field} >= (date_trunc('day', ${localNow}) AT TIME ZONE 'America/Bogota') AND ${field} < ((date_trunc('day', ${localNow}) + interval '1 day') AT TIME ZONE 'America/Bogota')`;
  }
  if (period === "week") {
    return `${field} >= (date_trunc('week', ${localNow}) AT TIME ZONE 'America/Bogota') AND ${field} < ((date_trunc('week', ${localNow}) + interval '1 week') AT TIME ZONE 'America/Bogota')`;
  }
  if (period === "month") {
    return `${field} >= (date_trunc('month', ${localNow}) AT TIME ZONE 'America/Bogota') AND ${field} < ((date_trunc('month', ${localNow}) + interval '1 month') AT TIME ZONE 'America/Bogota')`;
  }
  return "TRUE";
}

async function calculateDailyCash() {
  const result = await query(`
    SELECT
      COALESCE((SELECT base_amount FROM cash_registers WHERE business_date = CURRENT_DATE), 0)::float AS base_amount,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN payment_method = 'cash' THEN total
            WHEN payment_method = 'flexible' THEN COALESCE(cash_received, 0) - COALESCE(change_amount, 0)
            ELSE 0
          END
        )
        FROM sales
        WHERE ${periodWhere("sales", "day")}
      ), 0)::float AS cash_sales,
      COALESCE((
        SELECT SUM(amount)
        FROM employee_credits
        WHERE status = 'paid' AND ${periodWhere("employee_credits", "day", "paid_at")}
      ), 0)::float AS paid_credits,
      COALESCE((
        SELECT SUM(amount)
        FROM expenses
        WHERE ${periodWhere("expenses", "day")}
      ), 0)::float AS expenses,
      COALESCE((
        SELECT SUM(amount)
        FROM employee_credits
        WHERE ${periodWhere("employee_credits", "day")} AND status = 'pending'
      ), 0)::float AS pending_credits
  `);
  const row = result.rows[0] as {
    base_amount: number;
    cash_sales: number;
    paid_credits: number;
    expenses: number;
    pending_credits: number;
  };
  return {
    ...row,
    expected_cash: row.base_amount + row.cash_sales + row.paid_credits - row.expenses
  };
}

router.get("/dashboard", requireLimitedAccounting, async (req, res) => {
  const period = String(req.query.period ?? "all");
  const salesPeriod = periodWhere("s", period);
  const expensesPeriod = periodWhere("expenses", period);
  const adjustmentsPeriod = periodWhere("cash_adjustments", period);
  const creditsPeriod = periodWhere("ec", period);
  const [totals, topProducts, lowStock, productivity, moneyFlow] = await Promise.all([
    query(`
      SELECT
        (
          COALESCE(SUM(CASE WHEN s.payment_method <> 'credit' THEN s.total ELSE 0 END), 0)
          + COALESCE((SELECT SUM(ec.amount) FROM employee_credits ec WHERE ec.status='paid' AND ${creditsPeriod}), 0)
        )::float AS income,
        COALESCE((SELECT SUM(amount) FROM expenses WHERE ${expensesPeriod}), 0)::float AS expenses,
        COALESCE((SELECT SUM(CASE WHEN type='surplus' THEN amount ELSE -amount END) FROM cash_adjustments WHERE ${adjustmentsPeriod}), 0)::float AS balance_adjustments,
        COUNT(s.id)::int AS sales_count
      FROM sales s
      WHERE ${salesPeriod}
    `),
    query(`
      SELECT p.name, COALESCE(SUM(si.quantity),0)::int AS quantity, COALESCE(SUM(si.total),0)::float AS total
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      WHERE ${salesPeriod}
      GROUP BY p.name
      ORDER BY quantity DESC
      LIMIT 6
    `),
    query(`
      SELECT id, name, stock, min_stock, image_url
      FROM products
      WHERE is_active = TRUE AND stock <= min_stock
      ORDER BY stock ASC
      LIMIT 8
    `),
    query(`
      SELECT u.id, u.name, COUNT(s.id)::int AS sales_count, COALESCE(SUM(s.total),0)::float AS total
      FROM users u
      LEFT JOIN sales s ON s.user_id = u.id
      LEFT JOIN dashboard_productivity_hidden dph ON dph.user_id = u.id
      WHERE dph.user_id IS NULL AND (${salesPeriod})
      GROUP BY u.id, u.name
      ORDER BY total DESC
      LIMIT 6
    `),
    query(`
      SELECT
        'Ingreso' AS type,
        s.total::float AS amount,
        created_at,
        CASE payment_method
          WHEN 'cash' THEN 'Efectivo'
          WHEN 'transfer' THEN 'Transferencia'
          WHEN 'flexible' THEN 'Flexible'
          WHEN 'credit' THEN 'Credito empleado'
          ELSE payment_method
        END AS label
      FROM sales s
      WHERE s.payment_method <> 'credit' AND ${salesPeriod}
      UNION ALL
      SELECT 'Ingreso' AS type, ec.amount::float AS amount, ec.paid_at AS created_at, 'Credito empleado pagado' AS label
      FROM employee_credits ec
      WHERE ec.status = 'paid' AND ec.paid_at IS NOT NULL AND ${periodWhere("ec", period, "paid_at")}
      UNION ALL
      SELECT 'Egreso' AS type, e.amount::float AS amount, e.created_at, COALESCE(et.name, e.category) AS label
      FROM expenses e
      LEFT JOIN expense_types et ON et.id = e.type_id
      WHERE ${periodWhere("e", period)}
      UNION ALL
      SELECT 'Ajuste' AS type, amount::float AS amount, created_at, type AS label FROM cash_adjustments ca
      WHERE ${periodWhere("ca", period)}
      ORDER BY created_at DESC
      LIMIT 30
    `)
  ]);

  return res.json({
    totals: totals.rows[0],
    topProducts: topProducts.rows,
    lowStock: lowStock.rows,
    productivity: productivity.rows,
    moneyFlow: moneyFlow.rows
  });
});

router.get("/cash-register/today", requireLimitedAccounting, async (_req, res) => {
  const [register, summary] = await Promise.all([
    query("SELECT * FROM cash_registers WHERE business_date = CURRENT_DATE LIMIT 1"),
    calculateDailyCash()
  ]);
  return res.json({ register: register.rows[0] ?? null, summary });
});

router.post("/cash-register/base", requirePermission("all"), async (req: AuthedRequest, res) => {
  const parsed = z.object({ base_amount: z.coerce.number().nonnegative() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Ingresa una base de caja valida." });
  const result = await query(
    `INSERT INTO cash_registers (business_date, base_amount, user_id)
     VALUES (CURRENT_DATE, $1, $2)
     ON CONFLICT (business_date)
     DO UPDATE SET base_amount=$1, user_id=$2, updated_at=NOW()
     RETURNING *`,
    [parsed.data.base_amount, req.user?.id]
  );
  return res.status(201).json(result.rows[0]);
});

router.post("/cash-register/close", requireLimitedAccounting, async (req: AuthedRequest, res) => {
  const parsed = z.object({ closing_amount: z.coerce.number().nonnegative() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Ingresa el efectivo contado en caja." });
  const summary = await calculateDailyCash();
  const discrepancy = parsed.data.closing_amount - summary.expected_cash;
  const result = await query(
    `INSERT INTO cash_registers
      (business_date, base_amount, closing_amount, expected_cash, discrepancy, closed_at, user_id)
     VALUES (CURRENT_DATE, $1, $2, $3, $4, NOW(), $5)
     ON CONFLICT (business_date)
     DO UPDATE SET closing_amount=$2, expected_cash=$3, discrepancy=$4, closed_at=NOW(), user_id=$5, updated_at=NOW()
     RETURNING *`,
    [summary.base_amount, parsed.data.closing_amount, summary.expected_cash, discrepancy, req.user?.id]
  );
  return res.json({ register: result.rows[0], summary: { ...summary, discrepancy } });
});

router.delete("/productivity/:userId", requirePermission("all"), async (req, res) => {
  try {
    const exists = await query("SELECT id FROM users WHERE id=$1", [req.params.userId]);
    if (!exists.rows[0]) {
      return res.status(404).json({ message: "No se pudo eliminar: el usuario de productividad no existe." });
    }
    await query(
      `INSERT INTO dashboard_productivity_hidden (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [req.params.userId]
    );
    return res.status(204).send();
  } catch {
    return res.status(500).json({ message: "No se pudo eliminar el dato de productividad por un error interno." });
  }
});

router.get("/employee-credits", requireLimitedAccounting, async (req, res) => {
  const period = String(req.query.period ?? "all");
  const result = await query(`
    SELECT ec.*, u.name AS user_name, paid.name AS paid_by_name
    FROM employee_credits ec
    JOIN users u ON u.id = ec.user_id
    LEFT JOIN users paid ON paid.id = ec.paid_by
    WHERE ${periodWhere("ec", period)}
    ORDER BY ec.created_at DESC
    LIMIT 100
  `);
  return res.json(result.rows);
});

router.post("/employee-credits/:id/pay", requirePermission("all"), async (req: AuthedRequest, res) => {
  const result = await query(
    `UPDATE employee_credits
     SET status='paid', paid_at=NOW(), paid_by=$1
     WHERE id=$2 AND status='pending'
     RETURNING *`,
    [req.user?.id, req.params.id]
  );
  if (!result.rows[0]) {
    return res.status(404).json({ message: "No se pudo marcar paz y salvo: el credito no existe o ya fue pagado." });
  }
  return res.json(result.rows[0]);
});

router.get("/expenses", requirePermission("all"), async (_req, res) => {
  const result = await query(`
    SELECT e.*, COALESCE(et.name, e.category) AS type_name, et.color AS type_color
    FROM expenses e
    LEFT JOIN expense_types et ON et.id = e.type_id
    ORDER BY e.created_at DESC
    LIMIT 100
  `);
  return res.json(result.rows);
});

router.get("/expense-types", requireLimitedAccounting, async (_req, res) => {
  const result = await query(`
    SELECT et.*, COUNT(e.id)::int AS expenses_count
    FROM expense_types et
    LEFT JOIN expenses e ON e.type_id = et.id
    GROUP BY et.id
    ORDER BY et.name ASC
  `);
  return res.json(result.rows);
});

router.post("/expense-types", requireLimitedAccounting, async (req, res) => {
  const parsed = expenseTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "No se pudo crear el tipo de egreso.",
      fields: parsed.error.issues.map((issue) => issue.message)
    });
  }
  try {
    const result = await query(
      `INSERT INTO expense_types (name, color, description)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [parsed.data.name.trim(), parsed.data.color, parsed.data.description ?? null]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ message: "No se pudo crear el tipo de egreso: ya existe uno con ese nombre." });
    }
    return res.status(500).json({ message: "No se pudo crear el tipo de egreso por un error interno." });
  }
});

router.delete("/expense-types/:id", requirePermission("all"), async (req, res) => {
  try {
    const result = await query("DELETE FROM expense_types WHERE id=$1 RETURNING id", [req.params.id]);
    if (!result.rows[0]) {
      return res.status(404).json({ message: "No se pudo eliminar: el tipo de egreso no existe." });
    }
    return res.status(204).send();
  } catch {
    return res.status(500).json({ message: "No se pudo eliminar el tipo de egreso por un error interno." });
  }
});

router.post("/expenses", requireLimitedAccounting, async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      concept: z.string().min(2, "El concepto debe tener minimo 2 caracteres."),
      amount: z.coerce.number().nonnegative(),
      type_id: z.string().uuid("Selecciona un tipo de egreso valido."),
      category: z.string().optional()
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "No se pudo guardar el egreso.",
      fields: parsed.error.issues.map((issue) => issue.message)
    });
  }
  if (parsed.data.amount <= 0) {
    return res.status(400).json({ message: "No se pudo guardar el egreso: el valor debe ser mayor a 0." });
  }
  try {
    const expenseType = await query<{ name: string }>("SELECT name FROM expense_types WHERE id=$1", [parsed.data.type_id]);
    if (!expenseType.rows[0]) {
      return res.status(400).json({ message: "No se pudo guardar el egreso: el tipo seleccionado no existe." });
    }
    const result = await query(
      `INSERT INTO expenses (concept, amount, category, type_id, user_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [parsed.data.concept.trim(), parsed.data.amount, expenseType.rows[0].name, parsed.data.type_id, req.user?.id]
    );
    return res.status(201).json(result.rows[0]);
  } catch {
    return res.status(500).json({ message: "No se pudo guardar el egreso por un error interno." });
  }
});

router.post("/adjustments", requirePermission("all"), async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      type: z.enum(["surplus", "shortage", "correction"]),
      amount: z.coerce.number(),
      reason: z.string().min(3)
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const result = await query(
    `INSERT INTO cash_adjustments (type, amount, reason, user_id)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [parsed.data.type, parsed.data.amount, parsed.data.reason, req.user?.id]
  );
  return res.status(201).json(result.rows[0]);
});

export default router;
