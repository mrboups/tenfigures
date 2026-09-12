import type { PoolClient, TradeRow } from "./db.ts";
import { q, qOne } from "./db.ts";
import type { Side, TradeStep } from "../shared/types.ts";

export interface StepRow {
  id: string;
  trade_id: string;
  side: Side;
  step_no: number;
  price: string | null;
  base_amount: string | null;
  quote_amount: string | null;
  status: "finished" | "cancelled" | "error";
  error: string | null;
  order_id: string | null;
  created_at: Date;
}

export function publicStep(row: StepRow): TradeStep {
  return {
    id: row.id,
    tradeId: row.trade_id,
    side: row.side,
    stepNo: row.step_no,
    price: row.price,
    baseAmount: row.base_amount,
    quoteAmount: row.quote_amount,
    status: row.status,
    error: row.error,
    orderId: row.order_id,
    createdAt: row.created_at.toISOString(),
  };
}

export async function nextStepNo(
  pool: PoolClient,
  tradeId: string,
  side: Side,
): Promise<number> {
  const row = await qOne<{ n: string }>(
    pool,
    `SELECT COALESCE(MAX(step_no), 0)::text AS n
       FROM trade_steps WHERE trade_id = $1 AND side = $2`,
    [tradeId, side],
  );
  return Number(row?.n ?? 0) + 1;
}

export async function addStep(
  pool: PoolClient,
  opts: {
    tradeId: string;
    side: Side;
    price: number | string | null;
    baseAmount: number | string | null;
    quoteAmount: number | string | null;
    status: "finished" | "cancelled" | "error";
    error?: string | null;
    orderId?: string | null;
  },
): Promise<void> {
  const stepNo = await nextStepNo(pool, opts.tradeId, opts.side);
  await pool.query(
    `INSERT INTO trade_steps
       (id, trade_id, side, step_no, price, base_amount, quote_amount, status, error, order_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      crypto.randomUUID(),
      opts.tradeId,
      opts.side,
      stepNo,
      opts.price == null ? null : String(opts.price),
      opts.baseAmount == null ? null : String(opts.baseAmount),
      opts.quoteAmount == null ? null : String(opts.quoteAmount),
      opts.status,
      opts.error ?? null,
      opts.orderId ?? null,
    ],
  );
}

export async function listSteps(
  pool: PoolClient,
  tradeId: string,
): Promise<TradeStep[]> {
  const rows = await q<StepRow>(
    pool,
    `SELECT * FROM trade_steps WHERE trade_id = $1 ORDER BY side, step_no`,
    [tradeId],
  );
  return rows.map(publicStep);
}

export async function ensureInitialStep(
  pool: PoolClient,
  trade: TradeRow,
): Promise<void> {
  const existing = await qOne<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM trade_steps WHERE trade_id = $1`,
    [trade.id],
  );
  if (Number(existing?.n ?? 0) > 0) return;
  const filled = Number(trade.entry_filled_amount ?? 0);
  if (!(filled > 0) && trade.status !== "in_position" && trade.status !== "closed") {
    return;
  }
  const amount = Number(trade.entry_filled_amount ?? trade.amount);
  const price = Number(trade.entry_filled_price ?? trade.entry_price ?? 0);
  await addStep(pool, {
    tradeId: trade.id,
    side: trade.side,
    price,
    baseAmount: amount,
    quoteAmount: amount * price,
    status: filled > 0 || trade.status === "closed" || trade.status === "in_position"
      ? "finished"
      : "error",
    error: trade.last_error,
    orderId: trade.entry_order_id,
  });
}
