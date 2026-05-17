import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
} from "lightweight-charts";
import {
  DrawingManager,
  TrendLine,
  ExtendedLine,
  Ray,
  VerticalLine,
  AndrewsPitchfork,
  PriceRange,
  Rectangle,
  Circle,
  Callout,
  AnchoredText,
  Arrow,
  ParallelChannel,
} from "lightweight-charts-drawing";
import { api } from "../services/tauriApi";
import type { CandleData, Interval } from "../types";
import { toChartTime, SYMBOL_SYNC_EVENT, type SymbolSyncPayload } from "../windows/shared";
import IntervalSelector from "./IntervalSelector";
import ChartNotes from "./ChartNotes";
import { DrawingToolbar, DrawingToolType, getRequiredAnchors, DrawingStyleSettings, DEFAULT_STYLE, lineStyleToDash } from "./DrawingToolbar";

type TrendlineAnchor = {
  time: number;
  price: number;
};

type DrawingData = {
  id: string;
  type: DrawingToolType;
  anchors: TrendlineAnchor[];
  text?: string;
  style?: DrawingStyleSettings;
};

function parseDrawingPayload(raw: string[]): DrawingData[] {
  if (raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw[0]);
    const drawings = parsed.drawings || [];
    return drawings.map((d: any) => {
      if (d.anchors) {
        return d;
      }
      if (d.anchorA && d.anchorB) {
        const anchors = [d.anchorA, d.anchorB];
        if (d.anchorC) anchors.push(d.anchorC);
        if (d.anchorD) anchors.push(d.anchorD);
        return { ...d, anchors };
      }
      return d;
    });
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
  symbol: initialSymbol,
  interval: initialInterval,
  candles: initialCandles,
  isLoading,
  freshness,
  lastSync,
  warning,
}: Props) {
  const [symbol, setSymbol] = useState<string | null>(initialSymbol);
  const [interval, setInterval] = useState<Interval>(initialInterval);
  const [candles, setCandles] = useState<CandleData[]>(initialCandles);
  const [linkInterval, setLinkInterval] = useState(true);

  // Sync candles from parent when interval is linked
  useEffect(() => {
    if (linkInterval) {
      setCandles(initialCandles);
    }
  }, [initialCandles, linkInterval]);

  // Listen for symbol sync events
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    async function setupListener() {
      unlisten = await listen<SymbolSyncPayload>(SYMBOL_SYNC_EVENT, (event) => {
        const { symbol: newSymbol, interval: newInterval } = event.payload;
        
        if (newSymbol !== symbol) {
          setSymbol(newSymbol);
        }
        
        if (linkInterval && newInterval !== interval) {
          setInterval(newInterval);
        }
      });
    }

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [symbol, interval, linkInterval]);

  // Load candles when interval is not linked
  useEffect(() => {
    if (linkInterval || !symbol) {
      return;
    }

    const currentSymbol = symbol;
    let cancelled = false;
    async function loadCandles() {
      try {
        const resp = await api.getChartData(currentSymbol, interval);
        if (!cancelled) {
          setCandles(resp.candles);
        }
      } catch {
        if (!cancelled) {
          setCandles([]);
        }
      }
    }

    loadCandles();

    return () => {
      cancelled = true;
    };
  }, [symbol, interval, linkInterval]);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ReturnType<
    ReturnType<typeof createChart>["addSeries"]
  > | null>(null);
  const previewLineRef = useRef<ReturnType<ReturnType<typeof createChart>["addSeries"]> | null>(null);
  const drawingManagerRef = useRef<DrawingManager | null>(null);
  const drawingIdsRef = useRef<Set<string>>(new Set());

  const [drawings, setDrawings] = useState<DrawingData[]>([]);
  const [showDrawings, setShowDrawings] = useState(false);
  const [selectedTool, setSelectedTool] = useState<DrawingToolType | null>(null);
  const [drawingAnchors, setDrawingAnchors] = useState<TrendlineAnchor[]>([]);
  const [previewLine, setPreviewLine] = useState<TrendlineAnchor[] | null>(null);
  const [drawingText, setDrawingText] = useState("");
  const [styleSettings, setStyleSettings] = useState<DrawingStyleSettings>(() => {
    try {
      const saved = localStorage.getItem("drawingStyleSettings");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {}
    return DEFAULT_STYLE;
  });

  useEffect(() => {
    localStorage.setItem("drawingStyleSettings", JSON.stringify(styleSettings));
  }, [styleSettings]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        setSelectedTool(null);
        setDrawingAnchors([]);
        setPreviewLine(null);
      }
      if (e.shiftKey && e.key.toLowerCase() === 'd') {
        setShowDrawings(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Load drawings when symbol changes ───────────────────────────
  useEffect(() => {
    if (!symbol) {
      setDrawings([]);
      setDrawingAnchors([]);
      setSelectedTool(null);
      return;
    }

    api.loadSrDrawings(symbol)
      .then((raw) => {
        setDrawings(parseDrawingPayload(raw));
      })
      .catch(() => {
        setDrawings([]);
      });
  }, [symbol]);
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
        mode: 1,
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

    const manager = new DrawingManager();
    manager.attach(chart, series, el);
    drawingManagerRef.current = manager;

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
      if (drawingManagerRef.current) {
        drawingManagerRef.current.detach();
        drawingManagerRef.current = null;
      }
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);


  // ── Handle chart clicks for drawing ─────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !selectedTool) return;

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
      const requiredAnchors = getRequiredAnchors(selectedTool);
      const newAnchors = [...drawingAnchors, clickedPoint];

      if (newAnchors.length < requiredAnchors) {
        setDrawingAnchors(newAnchors);
        if (newAnchors.length > 0) {
          setPreviewLine(newAnchors);
        }
      } else {
        const symbolValue = symbol;
        if (!symbolValue) return;

        const isTextTool = selectedTool === "callout" || selectedTool === "anchored-text";
        const drawing: DrawingData = {
          id: `${selectedTool}-${Date.now()}`,
          type: selectedTool,
          anchors: newAnchors,
          text: isTextTool ? (drawingText || "Text") : undefined,
          style: { ...styleSettings },
        };

        const nextDrawings = [...drawings, drawing];
        setDrawings(nextDrawings);
        setDrawingAnchors([]);
        setPreviewLine(null);
        setSelectedTool(null);
        setDrawingText("");
        api.saveSrDrawings(symbolValue, JSON.stringify({ drawings: nextDrawings })).catch(() => {});
      }
    };

    chart.subscribeClick(handleChartClick);
    return () => {
      chart.unsubscribeClick(handleChartClick);
    };
  }, [selectedTool, drawingAnchors, drawings, symbol, drawingText, styleSettings]);

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

  // ── Render all drawings ────────────────────────────────
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current || !drawingManagerRef.current) return;
    const manager = drawingManagerRef.current;

    try {
      drawingIdsRef.current.forEach(id => {
        manager.removeDrawing(id);
      });
      drawingIdsRef.current = new Set();

      drawings.forEach((drawing) => {
        try {
          let anchors = drawing.anchors.map(a => ({
            time: toChartTime(a.time, interval) as any,
            price: a.price,
          }));

          // Only sort by time for drawings that need chronological order
          // Other drawings have semantic anchor positions (e.g., ParallelChannel: start, end, width)
          const needsTimeSorting = [
            "trendline",
            "extended", 
            "ray",
            "price-range",
            "rectangle",
            "arrow",
          ].includes(drawing.type);

          if (needsTimeSorting) {
            anchors = anchors.sort((a, b) => {
              const timeA = typeof a.time === 'number' ? a.time : new Date(a.time).getTime();
              const timeB = typeof b.time === 'number' ? b.time : new Date(b.time).getTime();
              return timeA - timeB;
            });
          }

          const drawingStyle = drawing.style || DEFAULT_STYLE;
          const lineDash = lineStyleToDash(drawingStyle.lineStyle);
          const style: any = {
            lineColor: drawingStyle.lineColor,
            lineWidth: drawingStyle.lineWidth,
          };
          if (lineDash) {
            style.lineDash = lineDash;
          }

          let drawingInstance: any = null;

          switch (drawing.type) {
            case "trendline":
              drawingInstance = new TrendLine(drawing.id, anchors, style);
              break;
            case "extended":
              drawingInstance = new ExtendedLine(drawing.id, anchors, style);
              break;
            case "ray":
              drawingInstance = new Ray(drawing.id, anchors, style);
              break;
            case "vertical-line":
              drawingInstance = new VerticalLine(drawing.id, anchors, style);
              break;
            case "andrews-pitchfork":
              drawingInstance = new AndrewsPitchfork(drawing.id, anchors, style);
              break;
            case "price-range":
              drawingInstance = new PriceRange(drawing.id, anchors, style);
              break;
            case "rectangle":
              drawingInstance = new Rectangle(drawing.id, anchors, style);
              break;
            case "circle":
              drawingInstance = new Circle(drawing.id, anchors, style);
              break;
            case "callout":
              drawingInstance = new Callout(drawing.id, anchors, style, { text: drawing.text || "Note" });
              break;
            case "anchored-text":
              drawingInstance = new AnchoredText(drawing.id, anchors, style, { text: drawing.text || "Text" });
              break;
            case "arrow":
              drawingInstance = new Arrow(drawing.id, anchors, style);
              break;
            case "channel":
              if (anchors.length >= 3) {
                drawingInstance = new ParallelChannel(drawing.id, anchors, style);
              }
              break;
          }

          if (drawingInstance) {
            manager.addDrawing(drawingInstance);
            drawingIdsRef.current.add(drawing.id);
          }
        } catch (drawingErr) {
          console.error(`Error rendering drawing ${drawing.id}:`, drawingErr);
        }
      });
    } catch (err) {
      console.error("Error rendering drawings:", err);
    }
  }, [drawings, interval]);

  // ── Render preview line while drawing ─────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    if (previewLineRef.current) {
      try {
        chart.removeSeries(previewLineRef.current);
      } catch (e) {
        console.warn("Error removing preview line:", e);
      }
      previewLineRef.current = null;
    }

    if (!previewLine || previewLine.length < 2 || !selectedTool) return;

    // Only show preview line for tools that need chronological order
    const needsPreviewLine = [
      "trendline",
      "extended",
      "ray",
      "price-range",
      "rectangle",
      "arrow",
    ].includes(selectedTool);

    if (!needsPreviewLine) return;

    try {
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

      const data = previewLine
        .map(a => ({
          time: toChartTime(a.time, interval),
          value: a.price,
        }))
        .sort((a, b) => {
          const timeA = typeof a.time === 'number' ? a.time : new Date(a.time as string).getTime();
          const timeB = typeof b.time === 'number' ? b.time : new Date(b.time as string).getTime();
          return timeA - timeB;
        });

      line.setData(data as any);
      previewLineRef.current = line;
    } catch (e) {
      console.error("Error rendering preview line:", e);
    }
  }, [previewLine, interval, selectedTool]);

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
    const nextDrawings = drawings.filter((drawing) => drawing.id !== id);
    setDrawings(nextDrawings);
    await api.saveSrDrawings(symbol, JSON.stringify({ drawings: nextDrawings }));
  };

  const handleClearDrawings = async () => {
    if (!symbol) return;
    setDrawings([]);
    setDrawingAnchors([]);
    setSelectedTool(null);
    await api.clearSrDrawings(symbol);
  };

  return (
    <div className="chart-panel">
      {/* Header bar */}
      <div className={`chart-header${!linkInterval ? ' interval-unlinked' : ''}`} style={!linkInterval ? { background: '#fee2e2', borderBottomColor: '#fca5a5' } : {}}>
        <span className="chart-symbol">{symbol ?? "Select a symbol"}</span>
        <IntervalSelector value={interval} onChange={setInterval} />
        <button
          type="button"
          className={`link-interval-btn${!linkInterval ? ' unlinked' : ''}`}
          onClick={() => setLinkInterval(!linkInterval)}
          title={linkInterval ? "Unlink interval from main chart" : "Link interval to main chart"}
        >
          {linkInterval ? "🔗" : "🔓"}
        </button>
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
            <button
              type="button"
              className="sr-action-button"
              onClick={() => setShowDrawings(!showDrawings)}
              title="Shortcut: Shift + D"
            >
              {showDrawings ? "Hide panel" : "Show panel"}
            </button>
            {selectedTool && (
              <span className="sr-hint">
                Click {getRequiredAnchors(selectedTool)} point{getRequiredAnchors(selectedTool) > 1 ? "s" : ""} on chart to draw ({drawingAnchors.length}/{getRequiredAnchors(selectedTool)})
              </span>
            )}
          </div>

          {/* Chart area */}
          <div className="chart-canvas-container" ref={containerRef} style={{ position: "relative" }}>
            {symbol && (
              <DrawingToolbar
                selectedTool={selectedTool}
                onToolSelect={(tool) => {
                  setSelectedTool(tool);
                  setDrawingAnchors([]);
                  setPreviewLine(null);
                }}
                onClearDrawings={handleClearDrawings}
                onDeleteSelected={() => {
                  if (drawings.length > 0) {
                    handleDeleteDrawing(drawings[drawings.length - 1].id);
                  }
                }}
                drawingText={drawingText}
                onDrawingTextChange={setDrawingText}
                styleSettings={styleSettings}
                onStyleSettingsChange={setStyleSettings}
              />
            )}
            <ChartNotes
              symbol={symbol}
              panelType="sr"
              chartRef={chartRef}
              seriesRef={seriesRef}
              candles={candles}
              interval={interval}
            />
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
            {drawings.length > 0 && (
            <div className="sr-drawing-list">
              <strong>Saved drawings ({drawings.length})</strong>
              {drawings.map((drawing) => {
                const drawingStyle = drawing.style || DEFAULT_STYLE;
                return (
                <div key={drawing.id} className="sr-drawing-item" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div 
                    style={{ 
                      width: "16px", 
                      height: `${drawingStyle.lineWidth * 2}px`, 
                      background: drawingStyle.lineColor,
                      borderRadius: "2px",
                      flexShrink: 0,
                    }} 
                  />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <strong>{drawing.type}</strong>
                    {drawing.text && <em style={{ color: "#666", marginLeft: "4px" }}>"{drawing.text}"</em>}
                    {!drawing.text && drawing.anchors[0] && (
                      <span style={{ color: "#666" }}>
                        {" "}{drawing.anchors[0].price.toFixed(2)}
                        {drawing.anchors[1] && ` → ${drawing.anchors[1].price.toFixed(2)}`}
                      </span>
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
                );
              })}
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
