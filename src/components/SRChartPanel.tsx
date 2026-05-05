import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
} from "lightweight-charts";
import { api } from "../services/tauriApi";
import type { CandleData, Interval } from "../types";
import { toChartTime } from "../windows/shared";

type TrendlineAnchor = {
  time: number;
  price: number;
};

type DrawingType = "trendline" | "channel";

type TrendlineDrawing = {
  id: string;
  type: DrawingType;
  anchorA: TrendlineAnchor;
  anchorB: TrendlineAnchor;
  anchorC?: TrendlineAnchor;
  anchorD?: TrendlineAnchor;
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
  const manualTrendlineSeriesRef = useRef<Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>>>({});
  const previewLineRef = useRef<ReturnType<ReturnType<typeof createChart>["addSeries"]> | null>(null);

  const [trendlineDrawings, setTrendlineDrawings] = useState<TrendlineDrawing[]>([]);
    const [showDrawings, setShowDrawings] = useState(false);
    const [drawingType, setDrawingType] = useState<DrawingType>("trendline");
  const [isDrawingMode, setIsDrawingMode] = useState(false);
    const [anchorA, setAnchorA] = useState<TrendlineAnchor | null>(null);
    const [anchorB, setAnchorB] = useState<TrendlineAnchor | null>(null);
  const [previewLine, setPreviewLine] = useState<TrendlineAnchor[] | null>(null);
  const [editingState, setEditingState] = useState<{ trendlineId: string; anchor: "A" | "B" | "C" | "D" } | null>(null);

  useEffect(() => {
    if (isDrawingMode) {
      setEditingState(null);
      setAnchorB(null);
      setPreviewLine(null);
    }
  }, [isDrawingMode]);

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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.shiftKey && e.key.toLowerCase() === 'd') {
        setShowDrawings(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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

  // ── Handle chart clicks for trendline drawing and editing ─────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handleChartClick = (param: any) => {
      if (!param.point || !param.time || !seriesRef.current) {
        return;
      }

      const price = seriesRef.current.coordinateToPrice(param.point.y);
      if (price === null || price === undefined || Number.isNaN(price)) {
        return;
      }

      const clickedTime = convertClickTime(param.time);
      if (clickedTime === null) {
        return;
      }

      const clickedPoint: TrendlineAnchor = { time: clickedTime, price };

      // Case 1: Drawing a new trendline or channel
      if (isDrawingMode) {
        if (!anchorA) {
          setAnchorA(clickedPoint);
          setPreviewLine(null);
        } else if (!anchorB) {
          if (drawingType === "trendline") {
            const symbolValue = symbol;
            if (!symbolValue) return;

            const drawing: TrendlineDrawing = {
              id: `trendline-${Date.now()}`,
              type: "trendline",
              anchorA: anchorA!,
              anchorB: clickedPoint,
            };
            const nextDrawings = [...trendlineDrawings, drawing];
            setTrendlineDrawings(nextDrawings);
            setAnchorA(null);
            setAnchorB(null);
            setIsDrawingMode(false);
            api.saveSrDrawings(symbolValue, JSON.stringify({ drawings: nextDrawings })).catch(() => {});
          } else {
            setAnchorB(clickedPoint);
            setPreviewLine([anchorA!, clickedPoint]);
          }
        } else {
          const symbolValue = symbol;
          if (!symbolValue) return;

          const deltaPrice = anchorB!.price - anchorA!.price;
          const deltaTime = anchorB!.time - anchorA!.time;
          const anchorC = clickedPoint;
          const anchorD = {
            time: anchorC.time + deltaTime,
            price: anchorC.price + deltaPrice,
          };

          const drawing: TrendlineDrawing = {
            id: `channel-${Date.now()}`,
            type: "channel",
            anchorA: anchorA!,
            anchorB: anchorB!,
            anchorC,
            anchorD,
          };
          const nextDrawings = [...trendlineDrawings, drawing];
          setTrendlineDrawings(nextDrawings);
          setAnchorA(null);
          setAnchorB(null);
          setPreviewLine(null);
          setIsDrawingMode(false);
          api.saveSrDrawings(symbolValue, JSON.stringify({ drawings: nextDrawings })).catch(() => {});
        }
        return;
      }

      // Case 2: Moving a selected anchor
      if (editingState) {
        const { trendlineId, anchor } = editingState;
        const nextDrawings = trendlineDrawings.map((d) => {
          if (d.id === trendlineId) {
            if (anchor === "A") return { ...d, anchorA: clickedPoint };
            if (anchor === "B") return { ...d, anchorB: clickedPoint };
            if (anchor === "C" && d.anchorC) return { ...d, anchorC: clickedPoint };
            if (anchor === "D" && d.anchorD) return { ...d, anchorD: clickedPoint };
          }
          return d;
        });

        setTrendlineDrawings(nextDrawings);
        setEditingState(null);
        if (symbol) {
          api.saveSrDrawings(symbol, JSON.stringify({ drawings: nextDrawings })).catch(() => {});
        }
        return;
      }

      // Case 3: Selecting an anchor to edit
      const CLICK_PROXIMITY_THRESHOLD = 10; // pixels
      for (const drawing of trendlineDrawings) {
        const anchors = [
          { key: "A", coord: drawing.anchorA },
          { key: "B", coord: drawing.anchorB },
          ...(drawing.anchorC ? [{ key: "C", coord: drawing.anchorC }] : []),
          ...(drawing.anchorD ? [{ key: "D", coord: drawing.anchorD }] : []),
        ];

        for (const { key, coord } of anchors) {
          const anchorCoord = {
            x: chart.timeScale().timeToCoordinate(toChartTime(coord.time, interval)),
            y: seriesRef.current.priceToCoordinate(coord.price),
          };

          if (anchorCoord.x !== null && anchorCoord.y !== null) {
            const distance = Math.hypot(param.point.x - anchorCoord.x, param.point.y - anchorCoord.y);
            if (distance < CLICK_PROXIMITY_THRESHOLD) {
              setEditingState({ trendlineId: drawing.id, anchor: key as "A" | "B" | "C" | "D" });
              return;
            }
          }
        }
      }
    };

    chart.subscribeClick(handleChartClick);
    return () => {
      chart.unsubscribeClick(handleChartClick);
    };
  }, [anchorA, anchorB, previewLine, trendlineDrawings, isDrawingMode, symbol, editingState, interval]);

  // ── Update data whenever candles change ───────────────────────────────────
  useEffect(() => {
    if (!seriesRef.current) return;
    if (candles.length === 0) {
      seriesRef.current.setData([]);
      return;
    }

    try {
      const formatted = candles.map((c) => ({
        time: toChartTime(c.time, interval),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      seriesRef.current.setData(formatted as Parameters<typeof seriesRef.current.setData>[0]);
    } catch (err) {
      console.error('Error setting candle data:', err);
    }
  }, [candles, interval]);

  // ── Render trendline and channel drawings ────────────────────────────────
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;
    const chart = chartRef.current;

    try {
      Object.values(manualTrendlineSeriesRef.current).forEach((series) => {
        if (series) {
          chart.removeSeries(series);
        }
      });
      manualTrendlineSeriesRef.current = {};

      trendlineDrawings.forEach((drawing) => {
        if (drawing.type === "channel" && drawing.anchorC && drawing.anchorD) {
          const line1 = chart.addSeries(LineSeries, {
            color: "#2563eb",
            lineWidth: 2,
            lineStyle: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            autoscaleInfoProvider: () => ({
              priceRange: null,
            }),
          });

          line1.setData([
            { time: toChartTime(drawing.anchorA.time, interval), value: drawing.anchorA.price },
            { time: toChartTime(drawing.anchorB.time, interval), value: drawing.anchorB.price },
          ]);

          const line2 = chart.addSeries(LineSeries, {
            color: "#2563eb",
            lineWidth: 2,
            lineStyle: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            autoscaleInfoProvider: () => ({
              priceRange: null,
            }),
          });

          line2.setData([
            { time: toChartTime(drawing.anchorC.time, interval), value: drawing.anchorC.price },
            { time: toChartTime(drawing.anchorD.time, interval), value: drawing.anchorD.price },
          ]);

          const midA = {
            time: toChartTime(drawing.anchorA.time, interval),
            value: (drawing.anchorA.price + drawing.anchorC.price) / 2,
          };
          const midB = {
            time: toChartTime(drawing.anchorB.time, interval),
            value: (drawing.anchorB.price + drawing.anchorD.price) / 2,
          };

          const midLine = chart.addSeries(LineSeries, {
            color: "#2563eb80",
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            autoscaleInfoProvider: () => ({
              priceRange: null,
            }),
          });

          midLine.setData([midA, midB]);

          manualTrendlineSeriesRef.current[`${drawing.id}-1`] = line1;
          manualTrendlineSeriesRef.current[`${drawing.id}-2`] = line2;
          manualTrendlineSeriesRef.current[`${drawing.id}-mid`] = midLine;
        } else {
          const line = chart.addSeries(LineSeries, {
            color: "#2563eb",
            lineWidth: 2,
            lineStyle: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            autoscaleInfoProvider: () => ({
              priceRange: null,
            }),
          });

          line.setData([
            { time: toChartTime(drawing.anchorA.time, interval), value: drawing.anchorA.price },
            { time: toChartTime(drawing.anchorB.time, interval), value: drawing.anchorB.price },
          ]);

          manualTrendlineSeriesRef.current[drawing.id] = line;
        }
      });

      chart.timeScale().fitContent();
    } catch (err) {
      console.error("Error rendering trendlines:", err);
    }
  }, [trendlineDrawings, interval]);

  // ── Render preview line while drawing channel ─────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    if (previewLineRef.current) {
      chart.removeSeries(previewLineRef.current);
      previewLineRef.current = null;
    }

    if (previewLine && previewLine.length === 2) {
      const line = chart.addSeries(LineSeries, {
        color: "#94a3b8",
        lineWidth: 2,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        autoscaleInfoProvider: () => ({
          priceRange: null,
        }),
      });

      line.setData([
        { time: toChartTime(previewLine[0].time, interval), value: previewLine[0].price },
        { time: toChartTime(previewLine[1].time, interval), value: previewLine[1].price },
      ]);

      previewLineRef.current = line;
    }
  }, [previewLine, interval]);

  // ── Highlight edited trendline ──────────────────────────────────────────
  const prevEditingStateRef = useRef(editingState);
  useEffect(() => {
    const prevEditingState = prevEditingStateRef.current;
    // Reset previous one
    if (prevEditingState && prevEditingState.trendlineId) {
      const series = manualTrendlineSeriesRef.current[prevEditingState.trendlineId];
      if (series) {
        series.applyOptions({ color: "#2563eb" });
      }
    }

    // Highlight current one
    if (editingState && editingState.trendlineId) {
      const series = manualTrendlineSeriesRef.current[editingState.trendlineId];
      if (series) {
        series.applyOptions({ color: "#ff9100" });
      }
    }

    prevEditingStateRef.current = editingState;
  }, [editingState]);

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

      <div className="chart-content-wrapper">
        <div className="chart-main">
          <div className="sr-controls">
              <select
                className="sr-action-button"
                value={drawingType}
                onChange={(e) => setDrawingType(e.target.value as DrawingType)}
                style={{ marginRight: "8px" }}
              >
                <option value="trendline">Trendline</option>
                <option value="channel">Channel</option>
              </select>
              <button
                type="button"
                className="sr-action-button"
                onClick={() => {
                  if (editingState) {
                    setEditingState(null);
                  } else {
                    setIsDrawingMode((mode) => !mode);
                    setAnchorA(null);
                    setAnchorB(null);
                  }
                }}
              >
                {editingState ? "Cancel edit" : isDrawingMode ? "Cancel" : `Draw ${drawingType}`}
              </button>
            <button
              type="button"
              className="sr-action-button"
              onClick={handleClearDrawings}
              disabled={trendlineDrawings.length === 0}
            >
              Clear drawings
            </button>
            <button
              type="button"
              className="sr-action-button"
              onClick={() => setShowDrawings(!showDrawings)}
              title="Shortcut: Shift + D"
            >
              {showDrawings ? "Hide panel" : "Show panel"}
            </button>
            {isDrawingMode && (
              <span className="sr-hint">
                {drawingType === "trendline"
                  ? anchorA
                    ? "Click the chart to place the second trendline anchor."
                    : "Click the chart to place the first trendline anchor."
                  : anchorA
                    ? "Click the chart to place the third point (determines channel width)."
                    : "Click the chart to place the first channel anchor."}
              </span>
            )}
          </div>

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

        {showDrawings && (
          <div className="drawings-sidebar" style={{ width: '300px', borderLeft: '1px solid #ddd', padding: '10px' }}>
            {trendlineDrawings.length > 0 && (
            <div className="sr-drawing-list">
              <strong>Saved drawings</strong>
              {trendlineDrawings.map((drawing) => (
                <div key={drawing.id} className="sr-drawing-item">
                  <span>
                    {drawing.type === "channel" ? "Channel" : "Trendline"}: 
                    {new Date(drawing.anchorA.time * 1000).toISOString().slice(0, 10)} @ {drawing.anchorA.price} →
                    {new Date(drawing.anchorB.time * 1000).toISOString().slice(0, 10)} @ {drawing.anchorB.price}
                    {drawing.type === "channel" && drawing.anchorC && drawing.anchorD && (
                      <>, {new Date(drawing.anchorC.time * 1000).toISOString().slice(0, 10)} @ {drawing.anchorC.price} → {new Date(drawing.anchorD.time * 1000).toISOString().slice(0, 10)} @ {drawing.anchorD.price}</>
                    )}
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
        </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────


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
