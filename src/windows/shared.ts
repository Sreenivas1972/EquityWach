import type { CandleData, Interval } from "../types";

export const SYMBOL_SYNC_EVENT = "equitywatcher:symbol-sync";

export type SymbolSyncPayload = {
  symbol: string;
  interval: Interval;
  watchlistName: string | null;
};

export function toChartTime(ts: number, interval: Interval): string {
  const d = new Date(ts * 1000);
  if (interval === "day" || interval === "week" || interval === "month") {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return d.toISOString();
}

export function chartCandles(candles: CandleData[], interval: Interval) {
  return candles.map((c) => ({
    time: toChartTime(c.time, interval),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

export function ema(values: number[], period: number): Array<number | null> {
  if (period <= 1 || values.length === 0) {
    return values.map((v) => v);
  }

  const out: Array<number | null> = new Array(values.length).fill(null);
  const multiplier = 2 / (period + 1);
  let seeded = false;
  let prev = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!seeded) {
      if (i < period - 1) {
        continue;
      }
      const start = i - period + 1;
      const seed = values.slice(start, i + 1).reduce((sum, n) => sum + n, 0) / period;
      prev = seed;
      out[i] = seed;
      seeded = true;
      continue;
    }
    const next = (v - prev) * multiplier + prev;
    out[i] = next;
    prev = next;
  }

  return out;
}

export function lineSeriesData(
  candles: CandleData[],
  interval: Interval,
  values: Array<number | null>
) {
  const out: Array<{ time: string; value: number }> = [];
  for (let i = 0; i < candles.length; i++) {
    const v = values[i];
    if (v === null || Number.isNaN(v)) {
      continue;
    }
    out.push({
      time: toChartTime(candles[i].time, interval),
      value: v,
    });
  }
  return out;
}

export function randomId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}
