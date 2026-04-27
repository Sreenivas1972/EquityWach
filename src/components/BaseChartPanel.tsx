import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
  UTCTimestamp,
} from "lightweight-charts";
import { api } from "../services/tauriApi";
import type { CandleData, Interval, PivotSource } from "../types";

type CamarillaLevelMeta = {
  key: string;
  label: string;
  color: string;
  compute: (high: number, low: number, close: number) => number;
};

const CAMARILLA_LEVELS: CamarillaLevelMeta[] = [
  { key: "H5", label: "H5", color: "#c2255c", compute: (high, low, close) => (high / low) * close },
  { key: "H4", label: "H4", color: "#d9480f", compute: (high, low, close) => close + ((high - low) * 1.1) / 2 },
  { key: "H3", label: "H3", color: "#f08c00", compute: (high, low, close) => close + ((high - low) * 1.1) / 4 },
  { key: "H2", label: "H2", color: "#fab005", compute: (high, low, close) => close + ((high - low) * 1.1) / 6 },
  { key: "H1", label: "H1", color: "#ffd43b", compute: (high, low, close) => close + ((high - low) * 1.1) / 12 },
  { key: "PP", label: "PP", color: "#228be6", compute: (high, low, close) => (high + low + close) / 3 },
  { key: "L1", label: "L1", color: "#82c91e", compute: (high, low, close) => close - ((high - low) * 1.1) / 12 },
  { key: "L2", label: "L2", color: "#40c057", compute: (high, low, close) => close - ((high - low) * 1.1) / 6 },
  { key: "L3", label: "L3", color: "#12b886", compute: (high, low, close) => close - ((high - low) * 1.1) / 4 },
  { key: "L4", label: "L4", color: "#0ca678", compute: (high, low, close) => close - ((high - low) * 1.1) / 2 },
  { key: "L5", label: "L5", color: "#087f5b", compute: (high, low, close) => 2 * close - (high / low) * close },
];

interface Props {
  symbol: string | null;
  interval: Interval;
  candles: CandleData[];
  isLoading: boolean;
  freshness: string | null;
  lastSync: string | null;
  warning: string | null;
}

export default function BaseChartPanel({
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
  const pivotSeriesRef = useRef<Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>>>({});
  const pivotSourceRef = useRef<PivotSource | null>(null);

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
        vertLines: { visible: false },
        horzLines: { visible: false },
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

    const pivotLines: Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>> = {};
    CAMARILLA_LEVELS.forEach((level) => {
      pivotLines[level.key] = chart.addSeries(LineSeries, {
        color: level.color,
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: true,
        lastValueVisible: false,
        title: level.label,
      });
    });

    chartRef.current = chart;
    seriesRef.current = series;
    pivotSeriesRef.current = pivotLines;

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
      pivotSeriesRef.current = {};
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
      // Use ISO date string for day/week/month to avoid timezone offsets
      time: toChartTime(c.time, interval),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    seriesRef.current.setData(formatted as Parameters<typeof seriesRef.current.setData>[0]);

    if (interval === "month") {
      CAMARILLA_LEVELS.forEach((level) => {
        pivotSeriesRef.current[level.key]?.setData([]);
      });
      return;
    }

    if (candles.length >= 2 && pivotSourceRef.current) {
      const pivotSrc = pivotSourceRef.current;
      const high = pivotSrc.high;
      const low = pivotSrc.low;
      const close = pivotSrc.close;
      const drawFromTs = pivotSrc.draw_from;

      CAMARILLA_LEVELS.forEach((level) => {
        const value = low > 0 ? level.compute(high, low, close) : NaN;
        const line = pivotSeriesRef.current[level.key];
        if (!line || !Number.isFinite(value)) {
          line?.setData([]);
          return;
        }

        const lineData = formatted
          .filter((point) => {
            const pointTs = typeof point.time === "string" ? parseDateString(point.time) : point.time;
            return pointTs >= drawFromTs;
          })
          .map((point) => ({
            time: point.time,
            value,
          }));
        line.setData(lineData as Parameters<typeof line.setData>[0]);
      });
    } else {
      CAMARILLA_LEVELS.forEach((level) => {
        pivotSeriesRef.current[level.key]?.setData([]);
      });
    }

    chartRef.current?.timeScale().fitContent();
  }, [candles, interval, pivotSourceRef.current]);

  // ── Fetch pivot source data ───────────────────────────────────────────────
  useEffect(() => {
    if (!symbol || interval === "month") {
      pivotSourceRef.current = null;
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const ps = await api.getPivotSource(symbol, interval);
        if (!cancelled) {
          pivotSourceRef.current = ps;
        }
      } catch {
        // Silently fail; use previous pivot source or fall back to none
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol, interval]);

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
  // For day/week/month, use date string to sidestep timezone offsets
  if (interval === "day" || interval === "week" || interval === "month") {
    const d = new Date(ts * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return ts as UTCTimestamp;
}

function parseDateString(dateStr: string): number {
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const d = new Date(Date.UTC(year, month, day, 0, 0, 0));
    return d.getTime() / 1000;
  }
  return 0;
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
