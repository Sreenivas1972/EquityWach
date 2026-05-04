import type { UTCTimestamp } from "lightweight-charts";
import type { CandleData, Interval } from "../types";

export const SYMBOL_SYNC_EVENT = "equitywatcher:symbol-sync";

export type SymbolSyncPayload = {
  symbol: string;
  interval: Interval;
  watchlistName: string | null;
};

export function toChartTime(ts: number, interval: Interval): UTCTimestamp | string {
  if (interval === "day" || interval === "week" || interval === "month") {
    const d = new Date(ts * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return ts as UTCTimestamp;
}


