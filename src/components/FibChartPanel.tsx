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
  type: 'retracement' | 'extension' | 'projection';
  anchorA: FibAnchor;
  anchorB: FibAnchor;
  anchorC?: FibAnchor; // Only for extensions and projections
};

const FIB_RETRACEMENT_LEVELS = [
  { key: "fib_100", label: "100%", ratio: 0, color: "#c2255c" },
  { key: "fib_786", label: "78.6%", ratio: 0.236, color: "#d9480f" },
  { key: "fib_618", label: "61.8%", ratio: 0.382, color: "#f08c00" },
  { key: "fib_50", label: "50%", ratio: 0.5, color: "#fab005" },
  { key: "fib_382", label: "38.2%", ratio: 0.618, color: "#ffd43b" },
  { key: "fib_236", label: "23.6%", ratio: 0.786, color: "#40c057" },
  { key: "fib_0", label: "0%", ratio: 1, color: "#087f5b" },
];

const FIB_EXTENSION_LEVELS = [
  { key: "fib_0", label: "0%", ratio: 0, color: "#087f5b" },
  { key: "fib_100", label: "100%", ratio: 1, color: "#c2255c" },
  { key: "fib_161", label: "161.8%", ratio: 1.618, color: "#d9480f" },
  { key: "fib_261", label: "261.8%", ratio: 2.618, color: "#f08c00" },
  { key: "fib_423", label: "423.6%", ratio: 4.236, color: "#fab005" },
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
  const manualFibSeriesRef = useRef<Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>[]>>({});

  const [fibDrawings, setFibDrawings] = useState<FibDrawing[]>([]);
  const [drawingMode, setDrawingMode] = useState<'retracement' | 'extension' | 'projection' | null>(null);
  const [anchorA, setAnchorA] = useState<FibAnchor | null>(null);
  const [anchorB, setAnchorB] = useState<FibAnchor | null>(null);
  const [movingEndpoint, setMovingEndpoint] = useState<{
    drawingId: string;
    anchorKey: 'anchorA' | 'anchorB' | 'anchorC';
  } | null>(null);

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
        rightOffset: 15,
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

    chartRef.current = chart;
    seriesRef.current = series;

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
    };
  }, []);

  useEffect(() => {
    if (!symbol) {
      setFibDrawings([]);
      setDrawingMode(null);
      setAnchorA(null);
      setAnchorB(null);
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
      if (!param.point || !param.time) {
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

      // 1. Drop a moving endpoint
      if (movingEndpoint) {
        const nextDrawings = fibDrawings.map((d) => 
          d.id === movingEndpoint.drawingId 
            ? { ...d, [movingEndpoint.anchorKey]: clickedPoint } 
            : d
        );
        setFibDrawings(nextDrawings);
        setMovingEndpoint(null);
        if (symbol) {
          api.saveFibDrawings(symbol, JSON.stringify({ drawings: nextDrawings })).catch(() => {});
        }
        return;
      }

      // 2. Pick up an existing endpoint if not in drawing mode
      if (!drawingMode) {
        let clickedAnchor: { drawingId: string; anchorKey: "anchorA" | "anchorB" | "anchorC" } | null = null;
        for (const d of fibDrawings) {
          for (const key of ["anchorA", "anchorB", "anchorC"] as const) {
            if (!d[key]) continue;
            const anchor = d[key]!;
            const timeCoord = chart.timeScale().timeToCoordinate(toChartTime(anchor.time, interval));
            const priceCoord = seriesRef.current?.priceToCoordinate(anchor.price);
            if (timeCoord !== null && priceCoord !== null) {
              const dist = Math.hypot(param.point.x - (timeCoord as number), param.point.y - (priceCoord as number));
              if (dist < 15) {
                clickedAnchor = { drawingId: d.id, anchorKey: key };
                break;
              }
            }
          }
          if (clickedAnchor) break;
        }

        if (clickedAnchor) {
          setMovingEndpoint(clickedAnchor);
        }
        return;
      }

      // 3. Normal drawing mode
      if (!anchorA) {
        setAnchorA(clickedPoint);
        return;
      }

      if ((drawingMode === 'extension' || drawingMode === 'projection') && !anchorB) {
        setAnchorB(clickedPoint);
        return;
      }

      const symbolValue = symbol;
      if (!symbolValue) {
        return;
      }

      const drawing: FibDrawing = {
        id: `fib-${Date.now()}`,
        type: drawingMode,
        anchorA,
        anchorB: (drawingMode === 'extension' || drawingMode === 'projection') ? anchorB! : clickedPoint,
        ...((drawingMode === 'extension' || drawingMode === 'projection') && { anchorC: clickedPoint }),
      };
      const nextDrawings = [...fibDrawings, drawing];
      setFibDrawings(nextDrawings);
      setAnchorA(null);
      setAnchorB(null);
      setDrawingMode(null);
      api.saveFibDrawings(symbolValue, JSON.stringify({ drawings: nextDrawings })).catch(() => {});
    };

    chart.subscribeClick(handleChartClick);
    return () => {
      chart.unsubscribeClick(handleChartClick);
    };
  }, [anchorA, anchorB, fibDrawings, drawingMode, symbol, interval, movingEndpoint]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;

    Object.values(manualFibSeriesRef.current).flat().forEach((series) => {
      chart.removeSeries(series);
    });
    manualFibSeriesRef.current = {};

    fibDrawings.forEach((drawing) => {
      const seriesList: ReturnType<ReturnType<typeof createChart>["addSeries"]>[] = [];

      // Base trend line
      const baseLine = chart.addSeries(LineSeries, {
        color: "#7c3aed",
        lineWidth: 2,
        lineStyle: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        pointMarkersVisible: true,
        pointMarkersRadius: 5,
        autoscaleInfoProvider: () => ({
            priceRange: null, // This series will now be ignored for autoscaling
        }),
      });
      seriesList.push(baseLine);

      const levels = (drawing.type === 'extension' || drawing.type === 'projection') ? FIB_EXTENSION_LEVELS : FIB_RETRACEMENT_LEVELS;

      if (drawing.type === 'projection' && drawing.anchorC) {
        const anchorC = drawing.anchorC;
        // For projections: A -> B defines trend, C is projection point
        const trendRange = drawing.anchorB.price - drawing.anchorA.price;
        const trendDuration = Math.max(Math.abs(drawing.anchorB.time - drawing.anchorA.time), 86400);
        
        const projStart = Math.min(drawing.anchorB.time, anchorC.time);
        const projEnd = Math.max(drawing.anchorB.time, anchorC.time) + trendDuration;

        levels.forEach((level) => {
          const value = anchorC.price + trendRange * level.ratio;
          const line = chart.addSeries(LineSeries, {
            color: level.color,
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            autoscaleInfoProvider: () => ({
                priceRange: null, // This series will now be ignored for autoscaling
            }),
          });
          
          line.setData([
            { time: toChartTime(projStart, interval), value },
            { time: toChartTime(projEnd, interval), value },
          ]);
          seriesList.push(line);
        });

        const sortedPoints = [drawing.anchorA, drawing.anchorB, drawing.anchorC].sort((a, b) => a.time - b.time);
        baseLine.setData([
          { time: toChartTime(sortedPoints[0].time, interval), value: sortedPoints[0].price },
          { time: toChartTime(sortedPoints[1].time, interval), value: sortedPoints[1].price },
          { time: toChartTime(sortedPoints[2].time, interval), value: sortedPoints[2].price },
        ]);
      } else if (drawing.type === 'extension' && drawing.anchorC) {
        // For extensions: A -> B defines trend, C is extension point
        const trendRange = drawing.anchorB.price - drawing.anchorA.price;
        const extensionStart = Math.min(drawing.anchorB.time, drawing.anchorC.time);
        const extensionEnd = Math.max(drawing.anchorB.time, drawing.anchorC.time);

        levels.forEach((level) => {
          const value = drawing.anchorB.price + trendRange * level.ratio;
          const line = chart.addSeries(LineSeries, {
            color: level.color,
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            autoscaleInfoProvider: () => ({
              priceRange: null, // This series will now be ignored for autoscaling
            }),
          });
          line.setData([
            { time: toChartTime(extensionStart, interval), value },
            { time: toChartTime(extensionEnd, interval), value },
          ]);
          seriesList.push(line);
        });

        const sortedPoints = [drawing.anchorA, drawing.anchorB].sort((a, b) => a.time - b.time);
        baseLine.setData([
          { time: toChartTime(sortedPoints[0].time, interval), value: sortedPoints[0].price },
          { time: toChartTime(sortedPoints[1].time, interval), value: sortedPoints[1].price },
        ]);
      } else {
        // For retracements: levels between A and B
        const t1 = Math.min(drawing.anchorA.time, drawing.anchorB.time);
        const t2 = Math.max(drawing.anchorA.time, drawing.anchorB.time);
        
        const start = toChartTime(t1, interval);
        const end = toChartTime(t2, interval);
        const high = Math.max(drawing.anchorA.price, drawing.anchorB.price);
        const low = Math.min(drawing.anchorA.price, drawing.anchorB.price);

        levels.forEach((level) => {
          const value = high - (high - low) * level.ratio;
          const line = chart.addSeries(LineSeries, {
            color: level.color,
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            autoscaleInfoProvider: () => ({
              priceRange: null, // This series will now be ignored for autoscaling
          }),
          });
          line.setData([
            { time: start, value },
            { time: end, value },
          ]);
          seriesList.push(line);
        });

        const sortedPoints = [drawing.anchorA, drawing.anchorB].sort((a, b) => a.time - b.time);
        baseLine.setData([
          { time: toChartTime(sortedPoints[0].time, interval), value: sortedPoints[0].price },
          { time: toChartTime(sortedPoints[1].time, interval), value: sortedPoints[1].price },
        ]);
      }

      manualFibSeriesRef.current[drawing.id] = seriesList;
    });
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
    setDrawingMode(null);
    setAnchorA(null);
    setAnchorB(null);
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
            setDrawingMode(drawingMode === 'retracement' ? null : 'retracement');
            setAnchorA(null);
            setAnchorB(null);
          }}
        >
          {drawingMode === 'retracement' ? "Cancel fib retracement" : "Draw fib retracement"}
        </button>
        <button
          type="button"
          className="fib-action-button"
          onClick={() => {
            setDrawingMode(drawingMode === 'extension' ? null : 'extension');
            setAnchorA(null);
            setAnchorB(null);
          }}
        >
          {drawingMode === 'extension' ? "Cancel fib extension" : "Draw fib extension"}
        </button>
        <button
          type="button"
          className="fib-action-button"
          onClick={() => {
            setDrawingMode(drawingMode === 'projection' ? null : 'projection');
            setAnchorA(null);
            setAnchorB(null);
          }}
        >
          {drawingMode === 'projection' ? "Cancel fib projection" : "Draw fib projection"}
        </button>
        <button
          type="button"
          className="fib-action-button"
          onClick={handleClearDrawings}
          disabled={fibDrawings.length === 0}
        >
          Clear drawings
        </button>
        {drawingMode && (
          <span className="fib-hint">
            {drawingMode === 'retracement'
              ? (anchorA
                  ? "Click the chart to place the end point."
                  : "Click the chart to place the start point.")
              : (anchorA && !anchorB
                  ? "Click the chart to place the trend end point."
                  : anchorB
                  ? `Click the chart to place the ${drawingMode} point.`
                  : "Click the chart to place the trend start point.")
            }
          </span>
        )}
        {movingEndpoint && (
          <div className="fib-hint" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff0f6', color: '#c2255c', padding: '4px 12px', borderRadius: '4px' }}>
            <span>Moving endpoint... Click chart to place.</span>
            <button
              type="button"
              className="fib-action-button small"
              onClick={() => setMovingEndpoint(null)}
              style={{ margin: 0 }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {fibDrawings.length > 0 && (
        <div className="fib-drawing-list">
          <strong>Saved drawings</strong>
          {fibDrawings.map((drawing) => (
            <div key={drawing.id} className="fib-drawing-item">
              <span>
                Fib {drawing.type}: 
                {new Date(drawing.anchorA.time * 1000).toISOString().slice(0, 10)} @ {drawing.anchorA.price} →
                {new Date(drawing.anchorB.time * 1000).toISOString().slice(0, 10)} @ {drawing.anchorB.price}
                {(drawing.type === 'extension' || drawing.type === 'projection') && drawing.anchorC && (
                  <> →
                    {new Date(drawing.anchorC.time * 1000).toISOString().slice(0, 10)} @ {drawing.anchorC.price}
                  </>
                )}
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
    let drawings: any[] = [];

    if (Array.isArray(parsed?.drawings)) {
      drawings = parsed.drawings;
    } else if (Array.isArray(parsed)) {
      drawings = parsed;
    }

    // Ensure backward compatibility - old drawings don't have type field
    return drawings.map(drawing => ({
      ...drawing,
      type: drawing.type || 'retracement', // Default to retracement for old drawings
    })) as FibDrawing[];
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


