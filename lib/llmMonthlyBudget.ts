import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

const COLLECTION = "llmMonthlyBudget";

/** Unset → no budget enforcement. Example: `50` for USD/month globally (UTC calendar month). */
export function parseMonthlyBudgetUsd(): number | null {
  const raw = process.env.LLM_MONTHLY_BUDGET_USD?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** `YYYY-MM` in UTC — aligns with billing-style monthly resets. */
export function currentUtcMonthKey(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function parseUsdPerMtok(envKey: string, fallback: number): number {
  const raw = process.env[envKey]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Rough token→USD estimate from provider pricing env (defaults are placeholders — set env for accuracy).
 * Does not include Anthropic web-search surcharges; monitoring real invoices is still recommended.
 */
export function estimateUsdFromTokens(
  provider: "openai" | "anthropic",
  _model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const safeIn = Math.max(0, inputTokens);
  const safeOut = Math.max(0, outputTokens);
  if (provider === "openai") {
    const inPerM = parseUsdPerMtok("LLM_OPENAI_INPUT_USD_PER_MTOK", 0.15);
    const outPerM = parseUsdPerMtok("LLM_OPENAI_OUTPUT_USD_PER_MTOK", 0.6);
    return (safeIn / 1e6) * inPerM + (safeOut / 1e6) * outPerM;
  }
  const inPerM = parseUsdPerMtok("LLM_ANTHROPIC_INPUT_USD_PER_MTOK", 0.8);
  const outPerM = parseUsdPerMtok("LLM_ANTHROPIC_OUTPUT_USD_PER_MTOK", 4.0);
  return (safeIn / 1e6) * inPerM + (safeOut / 1e6) * outPerM;
}

async function readSpentUsd(db: Firestore, monthKey: string): Promise<number> {
  const snap = await db.collection(COLLECTION).doc(monthKey).get();
  const v = snap.data()?.spentUsd;
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
}

export type BudgetGateResult = { ok: true } | { ok: false; message: string };

/**
 * Soft gate before calling upstream LLMs. If budget is configured but Admin Firestore is missing,
 * logs once per process and allows the request (cannot persist spend — configure Admin for real caps).
 */
export async function assertMonthlyBudgetAllowsNewSpend(): Promise<BudgetGateResult> {
  const budget = parseMonthlyBudgetUsd();
  if (budget == null) return { ok: true };

  const db = getAdminFirestore();
  if (!db) {
    console.warn(
      "[llmMonthlyBudget] LLM_MONTHLY_BUDGET_USD is set but FIREBASE_SERVICE_ACCOUNT_JSON is missing — monthly spend is not tracked or enforced."
    );
    return { ok: true };
  }

  const monthKey = currentUtcMonthKey();
  const spent = await readSpentUsd(db, monthKey);
  if (spent >= budget) {
    return {
      ok: false,
      message: `Monthly LLM budget ($${budget.toFixed(2)} USD) is exhausted for ${monthKey} (UTC). Increase LLM_MONTHLY_BUDGET_USD or wait until next month.`,
    };
  }
  return { ok: true };
}

/** Record estimated USD after a successful provider response (token-derived). */
export async function recordLlmUsageUsd(opts: {
  provider: "openai" | "anthropic";
  model: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const budget = parseMonthlyBudgetUsd();
  if (budget == null) return;

  const db = getAdminFirestore();
  if (!db) return;

  const delta = estimateUsdFromTokens(opts.provider, opts.model, opts.inputTokens, opts.outputTokens);
  if (!(delta > 0)) return;

  const monthKey = currentUtcMonthKey();
  const ref = db.collection(COLLECTION).doc(monthKey);
  await ref.set(
    {
      spentUsd: FieldValue.increment(delta),
      updatedAt: FieldValue.serverTimestamp(),
      budgetUsdSnapshot: budget,
      monthKeyUtc: monthKey,
    },
    { merge: true }
  );
}
