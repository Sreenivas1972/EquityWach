import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
  UTCTimestamp,
} from "lightweight-charts";
import type { CandleData, Interval } from "../types";

interface Props {
  symbol: string | null;
  interval: Interval;
  candles: CandleData[];
  isLoading: boolean;
  freshness: string | null;
  lastSync: string | null;
  warning: string | null;
}

export default function EMAChartPanel({
  symbol,
  interval,
  candles,
  isLoading,
  freshness,
  lastSync,
  warning,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ReturnType<
    ReturnType<typeof createChart>["addSeries"]
  > | null>(null);
  const emaSeriesRef = useRef<Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>>>({});

  // ── Create chart once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { color: "#f4f7fb" },
        textColor: "#54657a",
      },
      grid: {
        vertLines: { color: "#dfe7f1" },
        horzLines: { color: "#dfe7f1" },
      },
      crosshair: {
        vertLine: { color: "#2563eb", width: 1, style: 2 },
        horzLine: { color: "#2563eb", width: 1, style: 2 },
      },
      timeScale: {
        borderColor: "#d4deea",
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: "#d4deea",
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#3fb950",
      downColor: "#f85149",
      borderUpColor: "#3fb950",
      borderDownColor: "#f85149",
      wickUpColor: "#3fb950",
      wickDownColor: "#f85149",
    });

    // Add EMA lines
    const emaColors = {
      ema20: "#f08c00",
      ema50: "#228be6",
      ema200: "#c2255c",
    };

    const emaLines: Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>> = {};
    Object.entries(emaColors).forEach(([key, color]) => {
      emaLines[key] = chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: true,
        title: key.toUpperCase(),
      });
    });

    chartRef.current = chart;
    seriesRef.current = series;
    emaSeriesRef.current = emaLines;

    const observer = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      emaSeriesRef.current = {};
    };
  }, []);

  // ── Update data whenever candles change ───────────────────────────────────
  useEffect(() => {
    if (!seriesRef.current) return;
    if (candles.length === 0) {
      seriesRef.current.setData([]);
      return;
    }

    const formatted = candles.map((c) => ({
      time: toChartTime(c.time, interval),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    seriesRef.current.setData(formatted as Parameters<typeof seriesRef.current.setData>[0]);

    // Calculate and display EMA lines
    const closePrices = candles.map((c) => c.close);
    const ema20 = calculateEMA(closePrices, 20);
    const ema50 = calculateEMA(closePrices, 50);
    const ema200 = calculateEMA(closePrices, 200);

    const ema20Data = formatEMALine(formatted, ema20);
    const ema50Data = formatEMALine(formatted, ema50);
    const ema200Data = formatEMALine(formatted, ema200);

    emaSeriesRef.current.ema20.setData(ema20Data as Parameters<typeof emaSeriesRef.current.ema20.setData>[0]);
    emaSeriesRef.current.ema50.setData(ema50Data as Parameters<typeof emaSeriesRef.current.ema50.setData>[0]);
    emaSeriesRef.current.ema200.setData(ema200Data as Parameters<typeof emaSeriesRef.current.ema200.setData>[0]);

    chartRef.current?.timeScale().fitContent();
  }, [candles, interval]);

  const freshnessLabel: Record<string, { text: string; color: string }> = {
    network_fetched: { text: "Live", color: "#3fb950" },
    partially_refreshed: { text: "Updated", color: "#3fb950" },
    fully_cached: { text: "Cached", color: "#8b949e" },
    cached_only: { text: "Offline", color: "#d29922" },
  };
  const fl = freshness ? freshnessLabel[freshness] : null;

  const syncAge = lastSync ? formatAge(lastSync) : null;

  return (
    <div className="chart-panel">
      {/* Header bar */}
      <div className="chart-header">
        <span className="chart-symbol">{symbol ?? "Select a symbol"}</span>
        <span className="chart-interval-badge">{interval.toUpperCase()}</span>
        <span className="chart-mode-badge">EMA</span>
        {fl && (
          <span className="chart-freshness" style={{ color: fl.color }}>
            ● {fl.text}
          </span>
        )}
        {syncAge && (
          <span className="chart-sync-age">Last sync: {syncAge}</span>
        )}
      </div>

      {/* Warning banner */}
      {warning && (
        <div className="chart-warning">
          ⚠ {warning}
        </div>
      )}

      {/* Chart area */}
      <div className="chart-canvas-container" ref={containerRef}>
        {isLoading && (
          <div className="chart-loading-overlay">
            <span className="spinner" />
            <span>Loading chart…</span>
          </div>
        )}
        {!isLoading && !symbol && (
          <div className="chart-placeholder">
            <span>Select a symbol from the watchlist →</span>
          </div>
        )}
        {!isLoading && symbol && candles.length === 0 && !isLoading && (
          <div className="chart-placeholder">
            <span>No data available for {symbol}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toChartTime(ts: number, interval: Interval): UTCTimestamp | string {
  // For day/week/month, use date string to sidestep timezone offsets in display
  if (interval === "day" || interval === "week" || interval === "month") {
    const d = new Date(ts * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return ts as UTCTimestamp;
}

function formatAge(isoString: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return "";
  }
}

function calculateEMA(values: number[], period: number): Array<number | null> {
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

function formatEMALine(
  candles: Array<{ time: string | UTCTimestamp; open: number; high: number; low: number; close: number }>,
  emaValues: Array<number | null>
): Array<{ time: string | UTCTimestamp; value: number }> {
  const out: Array<{ time: string | UTCTimestamp; value: number }> = [];
  for (let i = 0; i < candles.length; i++) {
    const v = emaValues[i];
    if (v === null || Number.isNaN(v)) {
      continue;
    }
    out.push({
      time: candles[i].time,
      value: v,
    });
  }
  return out;
}
