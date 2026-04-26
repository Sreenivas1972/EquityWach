import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
  UTCTimestamp,
} from "lightweight-charts";
import { api } from "../services/tauriApi";
import type { CandleData, Interval } from "../types";

type FibAnchor = {
  time: number;
  price: number;
};

type FibDrawing = {
  id: string;
  anchorA: FibAnchor;
  anchorB: FibAnchor;
};

const FIB_LEVELS = [
  { key: "fib_100", label: "100%", ratio: 0, color: "#c2255c" },
  { key: "fib_786", label: "78.6%", ratio: 0.236, color: "#d9480f" },
  { key: "fib_618", label: "61.8%", ratio: 0.382, color: "#f08c00" },
  { key: "fib_50", label: "50%", ratio: 0.5, color: "#fab005" },
  { key: "fib_382", label: "38.2%", ratio: 0.618, color: "#ffd43b" },
  { key: "fib_236", label: "23.6%", ratio: 0.786, color: "#40c057" },
  { key: "fib_0", label: "0%", ratio: 1, color: "#087f5b" },
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

export default function FibChartPanel({
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
  const fibSeriesRef = useRef<Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>>>({});
  const manualFibSeriesRef = useRef<Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>[]>>({});

  const [fibDrawings, setFibDrawings] = useState<FibDrawing[]>([]);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [anchorA, setAnchorA] = useState<FibAnchor | null>(null);

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

    // Add Fibonacci retracement lines
    const fibLevels = [
      { key: "fib_100", label: "100%", color: "#c2255c" },
      { key: "fib_786", label: "78.6%", color: "#d9480f" },
      { key: "fib_618", label: "61.8%", color: "#f08c00" },
      { key: "fib_50", label: "50%", color: "#fab005" },
      { key: "fib_382", label: "38.2%", color: "#ffd43b" },
      { key: "fib_236", label: "23.6%", color: "#40c057" },
      { key: "fib_0", label: "0%", color: "#087f5b" },
    ];

    const fibLines: Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>> = {};
    fibLevels.forEach((level) => {
      fibLines[level.key] = chart.addSeries(LineSeries, {
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
    fibSeriesRef.current = fibLines;

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
      fibSeriesRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!symbol) {
      setFibDrawings([]);
      setAnchorA(null);
      setIsDrawingMode(false);
      return;
    }

    api.loadFibDrawings(symbol)
      .then((raw) => {
        setFibDrawings(parseFibDrawingPayload(raw));
      })
      .catch(() => {
        setFibDrawings([]);
      });
  }, [symbol]);

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

      const clickedPoint: FibAnchor = {
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

      const drawing: FibDrawing = {
        id: `fib-${Date.now()}`,
        anchorA,
        anchorB: clickedPoint,
      };
      const nextDrawings = [...fibDrawings, drawing];
      setFibDrawings(nextDrawings);
      setAnchorA(null);
      setIsDrawingMode(false);
      api.saveFibDrawings(symbolValue, JSON.stringify({ drawings: nextDrawings })).catch(() => {});
    };

    chart.subscribeClick(handleChartClick);
    return () => {
      chart.unsubscribeClick(handleChartClick);
    };
  }, [anchorA, fibDrawings, isDrawingMode, symbol]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;

    Object.values(manualFibSeriesRef.current).flat().forEach((series) => {
      chart.removeSeries(series);
    });
    manualFibSeriesRef.current = {};

    fibDrawings.forEach((drawing) => {
      const seriesList: ReturnType<ReturnType<typeof createChart>["addSeries"]>[] = [];
      const baseLine = chart.addSeries(LineSeries, {
        color: "#7c3aed",
        lineWidth: 2,
        lineStyle: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        title: `Fib base ${drawing.id}`,
      });
      seriesList.push(baseLine);

      const start = toChartTime(drawing.anchorA.time, interval);
      const end = toChartTime(drawing.anchorB.time, interval);
      const high = Math.max(drawing.anchorA.price, drawing.anchorB.price);
      const low = Math.min(drawing.anchorA.price, drawing.anchorB.price);

      FIB_LEVELS.forEach((level) => {
        const value = high - (high - low) * level.ratio;
        const line = chart.addSeries(LineSeries, {
          color: level.color,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          title: `${drawing.id} ${level.label}`,
        });
        line.setData([
          { time: start, value },
          { time: end, value },
        ]);
        seriesList.push(line);
      });

      baseLine.setData([
        { time: toChartTime(drawing.anchorA.time, interval), value: drawing.anchorA.price },
        { time: toChartTime(drawing.anchorB.time, interval), value: drawing.anchorB.price },
      ]);

      manualFibSeriesRef.current[drawing.id] = seriesList;
    });

    chart.timeScale().fitContent();
  }, [fibDrawings, interval]);

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

    // Fibonacci retracement levels are based on the highest high and lowest low
    // in the visible data range
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const highestHigh = Math.max(...highs);
    const lowestLow = Math.min(...lows);
    const fibLevels = calculateFibonacciLevels(highestHigh, lowestLow);

    fibLevels.forEach((fib) => {
      const line = fibSeriesRef.current[fib.key];
      if (!line) return;

      const lineData = formatted.map((point) => ({
        time: point.time,
        value: fib.level,
      }));
      line.setData(lineData as Parameters<typeof line.setData>[0]);
    });

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

  const handleDeleteDrawing = async (id: string) => {
    if (!symbol) return;
    const nextDrawings = fibDrawings.filter((drawing) => drawing.id !== id);
    setFibDrawings(nextDrawings);
    await api.saveFibDrawings(symbol, JSON.stringify({ drawings: nextDrawings }));
  };

  const handleClearDrawings = async () => {
    if (!symbol) return;
    setFibDrawings([]);
    setAnchorA(null);
    setIsDrawingMode(false);
    await api.clearFibDrawings(symbol);
  };

  return (
    <div className="chart-panel">
      {/* Header bar */}
      <div className="chart-header">
        <span className="chart-symbol">{symbol ?? "Select a symbol"}</span>
        <span className="chart-interval-badge">{interval.toUpperCase()}</span>
        <span className="chart-mode-badge">Fibonacci</span>
        {fl && (
          <span className="chart-freshness" style={{ color: fl.color }}>
            ● {fl.text}
          </span>
        )}
        {syncAge && (
          <span className="chart-sync-age">Last sync: {syncAge}</span>
        )}
      </div>

      <div className="fib-controls">
        <button
          type="button"
          className="fib-action-button"
          onClick={() => {
            setIsDrawingMode((mode) => !mode);
            setAnchorA(null);
          }}
        >
          {isDrawingMode ? "Cancel fib drawing" : "Draw fib retracement"}
        </button>
        <button
          type="button"
          className="fib-action-button"
          onClick={handleClearDrawings}
          disabled={fibDrawings.length === 0}
        >
          Clear drawings
        </button>
        {isDrawingMode && (
          <span className="fib-hint">
            {anchorA
              ? "Click the chart to place the end point."
              : "Click the chart to place the start point."}
          </span>
        )}
      </div>

      {fibDrawings.length > 0 && (
        <div className="fib-drawing-list">
          <strong>Saved drawings</strong>
          {fibDrawings.map((drawing) => (
            <div key={drawing.id} className="fib-drawing-item">
              <span>
                Fib retracement: 
                {new Date(drawing.anchorA.time * 1000).toISOString().slice(0, 10)} @ {drawing.anchorA.price} →
                {new Date(drawing.anchorB.time * 1000).toISOString().slice(0, 10)} @ {drawing.anchorB.price}
              </span>
              <button
                type="button"
                className="fib-action-button small"
                onClick={() => handleDeleteDrawing(drawing.id)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

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

function convertClickTime(time: number | string): number | null {
  if (typeof time === "number") {
    return time;
  }

  const parsed = Date.parse(time);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.floor(parsed / 1000);
}

function parseFibDrawingPayload(raw: string | null): FibDrawing[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.drawings)) {
      return parsed.drawings as FibDrawing[];
    }

    if (Array.isArray(parsed)) {
      return parsed as FibDrawing[];
    }
  } catch {
    // ignore invalid payload
  }

  return [];
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

function calculateFibonacciLevels(high: number, low: number): {
  key: string;
  level: number;
  percentage: string;
  color: string;
}[] {
  const range = high - low;
  
  return [
    { key: "fib_100", level: high, percentage: "100%", color: "#c2255c" },
    { key: "fib_786", level: high - range * 0.236, percentage: "78.6%", color: "#d9480f" },
    { key: "fib_618", level: high - range * 0.382, percentage: "61.8%", color: "#f08c00" },
    { key: "fib_50", level: high - range * 0.5, percentage: "50%", color: "#fab005" },
    { key: "fib_382", level: high - range * 0.618, percentage: "38.2%", color: "#ffd43b" },
    { key: "fib_236", level: high - range * 0.786, percentage: "23.6%", color: "#40c057" },
    { key: "fib_0", level: low, percentage: "0%", color: "#087f5b" },
  ];
}
