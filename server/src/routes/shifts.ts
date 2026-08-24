import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";

const router = Router();

router.use(requireAuth);

router.get("/active", async (req: AuthedRequest, res) => {
  const result = await query(
    "SELECT * FROM shifts WHERE user_id=$1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
    [req.user?.id]
  );
  return res.json(result.rows[0] ?? null);
});

router.post("/start", async (req: AuthedRequest, res) => {
  const active = await query(
    "SELECT id FROM shifts WHERE user_id=$1 AND ended_at IS NULL LIMIT 1",
    [req.user?.id]
  );
  if (active.rows[0]) return res.status(409).json({ message: "Ya tienes una jornada activa" });
  const today = await query(
    `SELECT *
     FROM shifts
     WHERE user_id=$1 AND started_at::date = CURRENT_DATE
     ORDER BY started_at DESC
     LIMIT 1`,
    [req.user?.id]
  );
  if (today.rows[0]) {
    const result = await query(
      `UPDATE shifts
       SET started_at = NOW() - (ended_at - started_at), ended_at = NULL
       WHERE id=$1
       RETURNING *`,
      [today.rows[0].id]
    );
    return res.json(result.rows[0]);
  }
  const result = await query(
    `INSERT INTO shifts (user_id, hourly_rate)
     SELECT id, hourly_rate FROM users WHERE id=$1
     RETURNING *`,
    [req.user?.id]
  );
  return res.status(201).json(result.rows[0]);
});

router.post("/end", async (req: AuthedRequest, res) => {
  const result = await query(
    `UPDATE shifts SET ended_at=NOW()
     WHERE user_id=$1 AND ended_at IS NULL
     RETURNING *,
       EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600 AS hours,
       (EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600) * hourly_rate AS earned`,
    [req.user?.id]
  );
  return res.json(result.rows[0] ?? null);
});

router.get("/", async (req: AuthedRequest, res) => {
  const result = await query(
    `SELECT s.*, u.name AS user_name,
            EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at)) / 3600 AS hours,
            (EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at)) / 3600) * s.hourly_rate AS earned
     FROM shifts s
     JOIN users u ON u.id = s.user_id
     WHERE (($1::text[] @> ARRAY['all']) OR s.user_id = $2) AND s.payment_id IS NULL
     ORDER BY s.started_at DESC
     LIMIT 100`,
    [req.user?.permissions ?? [], req.user?.id]
  );
  return res.json(result.rows);
});

router.get("/payroll/summary", requirePermission("all"), async (_req, res) => {
  const result = await query(`
    SELECT
      u.id AS user_id,
      u.name AS user_name,
      COUNT(s.id)::int AS shifts_count,
      COALESCE(SUM(EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 3600), 0)::float AS hours,
      COALESCE(SUM((EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 3600) * s.hourly_rate), 0)::float AS amount
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    WHERE s.ended_at IS NOT NULL AND s.payment_id IS NULL
    GROUP BY u.id, u.name
    HAVING COUNT(s.id) > 0
    ORDER BY amount DESC
  `);
  return res.json(result.rows);
});

router.get("/payroll/payments", requirePermission("all"), async (_req, res) => {
  const result = await query(`
    SELECT sp.*, u.name AS user_name, admin.name AS paid_by_name
    FROM shift_payments sp
    JOIN users u ON u.id = sp.user_id
    LEFT JOIN users admin ON admin.id = sp.paid_by
    ORDER BY sp.paid_at DESC
    LIMIT 100
  `);
  return res.json(result.rows);
});

router.post("/payroll/:userId/pay", requirePermission("all"), async (req: AuthedRequest, res) => {
  const pending = await query<{
    hours: string;
    amount: string;
    shifts_count: number;
  }>(
    `SELECT
      COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600), 0) AS hours,
      COALESCE(SUM((EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600) * hourly_rate), 0) AS amount,
      COUNT(id)::int AS shifts_count
     FROM shifts
     WHERE user_id=$1 AND ended_at IS NOT NULL AND payment_id IS NULL`,
    [req.params.userId]
  );
  const row = pending.rows[0];
  if (!row || row.shifts_count === 0) {
    return res.status(400).json({ message: "No hay horas pendientes para pagar a este empleado." });
  }
  const payment = await query<{ id: string }>(
    `INSERT INTO shift_payments (user_id, paid_by, hours, amount, shifts_count)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id`,
    [req.params.userId, req.user?.id, row.hours, row.amount, row.shifts_count]
  );
  await query(
    `UPDATE shifts SET payment_id=$1
     WHERE user_id=$2 AND ended_at IS NOT NULL AND payment_id IS NULL`,
    [payment.rows[0].id, req.params.userId]
  );
  return res.status(201).json({ id: payment.rows[0].id, ...row });
});

export default router;
