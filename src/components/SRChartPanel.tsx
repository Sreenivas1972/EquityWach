import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
  UTCTimestamp,
} from "lightweight-charts";
import { api } from "../services/tauriApi";
import type { CandleData, Interval } from "../types";

type TrendlineAnchor = {
  time: number;
  price: number;
};

type TrendlineDrawing = {
  id: string;
  anchorA: TrendlineAnchor;
  anchorB: TrendlineAnchor;
};

function parseTrendlineDrawingPayload(raw: string[]): TrendlineDrawing[] {
  if (raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw[0]);
    return parsed.drawings || [];
  } catch {
    return [];
  }
}

function convertClickTime(time: any): number | null {
  if (typeof time === "string") {
    // For day/week/month intervals, time is a date string like "2023-01-01"
    const date = new Date(time + "T00:00:00Z");
    return date.getTime() / 1000;
  }
  if (typeof time === "number") {
    return time;
  }
  return null;
}

interface Props {
  symbol: string | null;
  interval: Interval;
  candles: CandleData[];
  isLoading: boolean;
  freshness: string | null;
  lastSync: string | null;
  warning: string | null;
}

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

export default function SRChartPanel({
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
  const manualTrendlineSeriesRef = useRef<Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>>>({});

  const [trendlineDrawings, setTrendlineDrawings] = useState<TrendlineDrawing[]>([]);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [anchorA, setAnchorA] = useState<TrendlineAnchor | null>(null);

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

  // ── Load trendline drawings when symbol changes ───────────────────────────
  useEffect(() => {
    if (!symbol) {
      setTrendlineDrawings([]);
      setAnchorA(null);
      setIsDrawingMode(false);
      return;
    }

    api.loadSrDrawings(symbol)
      .then((raw) => {
        setTrendlineDrawings(parseTrendlineDrawingPayload(raw));
      })
      .catch(() => {
        setTrendlineDrawings([]);
      });
  }, [symbol]);

  // ── Handle chart clicks for trendline drawing ─────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handleChartClick = (param: any) => {
      if (!isDrawingMode || !param.point || !param.time) {
        return;
      }

      const price = seriesRef.current?.coordinateToPrice(param.point.y);
      if (price === null || price === undefined || Number.isNaN(price as number)) {
        return;
      }

      const clickedTime = convertClickTime(param.time);
      if (clickedTime === null) {
        return;
      }

      const clickedPoint: TrendlineAnchor = {
        time: clickedTime,
        price,
      };

      if (!anchorA) {
        setAnchorA(clickedPoint);
        return;
      }

      const symbolValue = symbol;
      if (!symbolValue) {
        return;
      }

      const drawing: TrendlineDrawing = {
        id: `trendline-${Date.now()}`,
        anchorA,
        anchorB: clickedPoint,
      };
      const nextDrawings = [...trendlineDrawings, drawing];
      setTrendlineDrawings(nextDrawings);
      setAnchorA(null);
      setIsDrawingMode(false);
      api.saveSrDrawings(symbolValue, JSON.stringify({ drawings: nextDrawings })).catch(() => {});
    };

    chart.subscribeClick(handleChartClick);
    return () => {
      chart.unsubscribeClick(handleChartClick);
    };
  }, [anchorA, trendlineDrawings, isDrawingMode, symbol]);

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

    // Camarilla levels are derived from the previous completed candle and
    // rendered as horizontal overlays across the visible range.
    if (candles.length >= 2) {
      const prev = candles[candles.length - 2];
      const high = prev.high;
      const low = prev.low;
      const close = prev.close;

      CAMARILLA_LEVELS.forEach((level) => {
        const value = low > 0 ? level.compute(high, low, close) : NaN;
        const line = pivotSeriesRef.current[level.key];
        if (!line || !Number.isFinite(value)) {
          line?.setData([]);
          return;
        }

        const lineData = formatted.map((point) => ({
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
  }, [candles, interval]);

  // ── Render trendline drawings ─────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;

    Object.values(manualTrendlineSeriesRef.current).flat().forEach((series) => {
      chart.removeSeries(series);
    });
    manualTrendlineSeriesRef.current = {};

    trendlineDrawings.forEach((drawing) => {
      const line = chart.addSeries(LineSeries, {
        color: "#2563eb",
        lineWidth: 2,
        lineStyle: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        title: `Trendline ${drawing.id}`,
      });

      line.setData([
        { time: toChartTime(drawing.anchorA.time, interval), value: drawing.anchorA.price },
        { time: toChartTime(drawing.anchorB.time, interval), value: drawing.anchorB.price },
      ]);

      manualTrendlineSeriesRef.current[drawing.id] = line;
    });

    chart.timeScale().fitContent();
  }, [trendlineDrawings, interval]);

  const freshnessLabel: Record<string, { text: string; color: string }> = {
    network_fetched: { text: "Live", color: "#3fb950" },
    partially_refreshed: { text: "Updated", color: "#3fb950" },
    fully_cached: { text: "Cached", color: "#8b949e" },
    cached_only: { text: "Offline", color: "#d29922" },
  };
  const fl = freshness ? freshnessLabel[freshness] : null;

  const syncAge = lastSync ? formatAge(lastSync) : null;

  const handleDeleteDrawing = async (id: string) => {
    if (!symbol) return;
    const nextDrawings = trendlineDrawings.filter((drawing) => drawing.id !== id);
    setTrendlineDrawings(nextDrawings);
    await api.saveSrDrawings(symbol, JSON.stringify({ drawings: nextDrawings }));
  };

  const handleClearDrawings = async () => {
    if (!symbol) return;
    setTrendlineDrawings([]);
    setAnchorA(null);
    setIsDrawingMode(false);
    await api.clearSrDrawings(symbol);
  };

  return (
    <div className="chart-panel">
      {/* Header bar */}
      <div className="chart-header">
        <span className="chart-symbol">{symbol ?? "Select a symbol"}</span>
        <span className="chart-interval-badge">{interval.toUpperCase()}</span>
        <span className="chart-mode-badge">SR Levels</span>
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

      <div className="sr-controls">
        <button
          type="button"
          className="sr-action-button"
          onClick={() => {
            setIsDrawingMode((mode) => !mode);
            setAnchorA(null);
          }}
        >
          {isDrawingMode ? "Cancel trendline" : "Draw trendline"}
        </button>
        <button
          type="button"
          className="sr-action-button"
          onClick={handleClearDrawings}
          disabled={trendlineDrawings.length === 0}
        >
          Clear drawings
        </button>
        {isDrawingMode && (
          <span className="sr-hint">
            {anchorA
              ? "Click the chart to place the second trendline anchor."
              : "Click the chart to place the first trendline anchor."}
          </span>
        )}
      </div>

      {trendlineDrawings.length > 0 && (
        <div className="sr-drawing-list">
          <strong>Saved trendlines</strong>
          {trendlineDrawings.map((drawing) => (
            <div key={drawing.id} className="sr-drawing-item">
              <span>
                Trendline: 
                {new Date(drawing.anchorA.time * 1000).toISOString().slice(0, 10)} @ {drawing.anchorA.price} →
                {new Date(drawing.anchorB.time * 1000).toISOString().slice(0, 10)} @ {drawing.anchorB.price}
              </span>
              <button
                type="button"
                className="sr-delete-button"
                onClick={() => handleDeleteDrawing(drawing.id)}
              >
                ×
              </button>
            </div>
          ))}
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
