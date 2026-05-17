import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
} from "lightweight-charts";
import { api } from "../services/tauriApi";
import type { CandleData, FibToolDefaults, Interval } from "../types";
import { toChartTime, SYMBOL_SYNC_EVENT, type SymbolSyncPayload } from "../windows/shared";
import { DEFAULT_FIB_TOOL_DEFAULTS, loadFibSettings } from "../utils/fibSettingsUtils";
import IntervalSelector from "./IntervalSelector";
import ChartNotes from "./ChartNotes";
import FibSettingsWindow from "./FibSettingsWindow";

type FibAnchor = {
  time: number;
  price: number;
};

type FibDrawing = {
  id: string;
  type: 'retracement' | 'extension' | 'projection';
  anchorA: FibAnchor;
  anchorB: FibAnchor;
  anchorC?: FibAnchor;
  extendRight?: boolean;
  extendToBars?: number;
};

interface FibLevelConfig {
  key: string;
  label: string;
  ratio: number;
  color: string;
}

function buildFibLevelConfig(defaults: FibToolDefaults): {
  retracement: FibLevelConfig[];
  extension: FibLevelConfig[];
  projection: FibLevelConfig[];
} {
  return {
    retracement: defaults.retracement.map((l, i) => ({
      key: `fib_${i}`,
      label: `${(l.value * 100).toFixed(1)}%`.replace(/\.0%$/, '%'),
      ratio: l.value,
      color: l.color,
    })),
    extension: defaults.extension.map((l, i) => ({
      key: `fib_ext_${i}`,
      label: `${(l.value * 100).toFixed(1)}%`.replace(/\.0%$/, '%'),
      ratio: l.value,
      color: l.color,
    })),
    projection: defaults.projection.map((l, i) => ({
      key: `fib_proj_${i}`,
      label: `${(l.value * 100).toFixed(1)}%`.replace(/\.0%$/, '%'),
      ratio: l.value,
      color: l.color,
    })),
  };
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

export default function FibChartPanel({
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
  const [fibSettings, setFibSettings] = useState<FibToolDefaults>(DEFAULT_FIB_TOOL_DEFAULTS);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    loadFibSettings().then(setFibSettings).catch(() => {});
  }, []);

  const fibLevels = buildFibLevelConfig(fibSettings);

  useEffect(() => {
    if (linkInterval) {
      setCandles(initialCandles);
    }
  }, [initialCandles, linkInterval]);

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
  const manualFibSeriesRef = useRef<Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>[]>>({});

  const [fibDrawings, setFibDrawings] = useState<FibDrawing[]>([]);
  const [showDrawings, setShowDrawings] = useState(false);
  const [drawingMode, setDrawingMode] = useState<'retracement' | 'extension' | 'projection' | null>(null);
  const [anchorA, setAnchorA] = useState<FibAnchor | null>(null);
  const [anchorB, setAnchorB] = useState<FibAnchor | null>(null);
  const [movingEndpoint, setMovingEndpoint] = useState<{
    drawingId: string;
    anchorKey: 'anchorA' | 'anchorB' | 'anchorC';
  } | null>(null);

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

    const getExtendedTime = (baseTime: number, drawing: FibDrawing): number => {
      let bars = 0;
      if (drawing.extendRight) {
        bars = 200;
      } else if (drawing.extendToBars && drawing.extendToBars > 0) {
        bars = drawing.extendToBars;
      }

      if (bars === 0) return baseTime;

      let seconds = 86400;
      if (interval === 'week') seconds = 7 * 86400;
      if (interval === 'month') seconds = 30 * 86400;

      if (drawing.extendRight && candles.length > 0) {
        const lastCandleTime = candles[candles.length - 1].time;
        return Math.max(baseTime, lastCandleTime) + bars * seconds;
      }

      return baseTime + bars * seconds;
    };

    fibDrawings.forEach((drawing) => {
      const seriesList: ReturnType<ReturnType<typeof createChart>["addSeries"]>[] = [];

      const baseLine = chart.addSeries(LineSeries, {
        color: "#7c3aed",
        lineWidth: 3,
        lineStyle: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        pointMarkersVisible: true,
        pointMarkersRadius: 5,
        autoscaleInfoProvider: () => ({
            priceRange: null,
        }),
      });
      seriesList.push(baseLine);

      const levels = (drawing.type === 'extension' || drawing.type === 'projection') 
        ? fibLevels[drawing.type] 
        : fibLevels.retracement;

      if (drawing.type === 'projection' && drawing.anchorC) {
        const anchorC = drawing.anchorC;
        const trendRange = drawing.anchorB.price - drawing.anchorA.price;
        const trendDuration = Math.max(Math.abs(drawing.anchorB.time - drawing.anchorA.time), 86400);
        
        const projStart = Math.min(drawing.anchorB.time, anchorC.time);
        const projEnd = Math.max(drawing.anchorB.time, anchorC.time) + trendDuration;

        levels.forEach((level) => {
          const value = anchorC.price + trendRange * level.ratio;
          const line = chart.addSeries(LineSeries, {
            color: level.color,
            lineWidth: 2,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            autoscaleInfoProvider: () => ({
                priceRange: null,
            }),
          });
          
          const s1 = toChartTime(projStart, interval);
          const s2 = toChartTime(getExtendedTime(projEnd, drawing), interval);
          line.setData(
            s1 === s2
              ? [{ time: s1, value }]
              : [
                  { time: s1, value },
                  { time: s2, value },
                ]
          );
          seriesList.push(line);
        });

        const sortedPoints = [drawing.anchorA, drawing.anchorB, drawing.anchorC].sort((a, b) => a.time - b.time);
        baseLine.setData([
          { time: toChartTime(sortedPoints[0].time, interval), value: sortedPoints[0].price },
          { time: toChartTime(sortedPoints[1].time, interval), value: sortedPoints[1].price },
          { time: toChartTime(sortedPoints[2].time, interval), value: sortedPoints[2].price },
        ]);
      } else if (drawing.type === 'extension' && drawing.anchorC) {
        const trendRange = drawing.anchorB.price - drawing.anchorA.price;
        const extensionStart = Math.min(drawing.anchorB.time, drawing.anchorC.time);
        const extensionEnd = Math.max(drawing.anchorB.time, drawing.anchorC.time);

        levels.forEach((level) => {
          const value = drawing.anchorB.price + trendRange * level.ratio;
          const line = chart.addSeries(LineSeries, {
            color: level.color,
            lineWidth: 2,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            autoscaleInfoProvider: () => ({
              priceRange: null,
            }),
          });
          const s1 = toChartTime(extensionStart, interval);
          const s2 = toChartTime(getExtendedTime(extensionEnd, drawing), interval);
          line.setData(
            s1 === s2
              ? [{ time: s1, value }]
              : [
                  { time: s1, value },
                  { time: s2, value },
                ]
          );
          seriesList.push(line);
        });

        const sortedPoints = [drawing.anchorA, drawing.anchorB].sort((a, b) => a.time - b.time);
        const t0 = toChartTime(sortedPoints[0].time, interval);
        const t1 = toChartTime(sortedPoints[1].time, interval);
        baseLine.setData(
          t0 === t1
            ? [{ time: t0, value: sortedPoints[0].price }]
            : [
                { time: t0, value: sortedPoints[0].price },
                { time: t1, value: sortedPoints[1].price },
              ]
        );
      } else {
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
            lineWidth: 2,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            autoscaleInfoProvider: () => ({
              priceRange: null,
          }),
          });
          line.setData(
            start === end
              ? [{ time: start, value }]
              : [
                  { time: start, value },
                  { time: toChartTime(getExtendedTime(t2, drawing), interval), value },
                ]
          );
          seriesList.push(line);
        });

        const sortedPoints = [drawing.anchorA, drawing.anchorB].sort((a, b) => a.time - b.time);
        const chartT0 = toChartTime(sortedPoints[0].time, interval);
        const chartT1 = toChartTime(sortedPoints[1].time, interval);
        baseLine.setData(
          chartT0 === chartT1
            ? [{ time: chartT0, value: sortedPoints[0].price }]
            : [
                { time: chartT0, value: sortedPoints[0].price },
                { time: chartT1, value: sortedPoints[1].price },
              ]
        );
      }

      manualFibSeriesRef.current[drawing.id] = seriesList;
    });
  }, [fibDrawings, interval, fibLevels]);

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

  const handleUpdateDrawing = async (id: string, updates: Partial<FibDrawing>) => {
    if (!symbol) return;
    const nextDrawings = fibDrawings.map((d) => (d.id === id ? { ...d, ...updates } : d));
    setFibDrawings(nextDrawings);
    await api.saveFibDrawings(symbol, JSON.stringify({ drawings: nextDrawings })).catch(() => {});
  };

  const handleClearDrawings = async () => {
    if (!symbol) return;
    setFibDrawings([]);
    setDrawingMode(null);
    setAnchorA(null);
    setAnchorB(null);
    await api.clearFibDrawings(symbol);
  };

  const handleSettingsSave = (newSettings: FibToolDefaults) => {
    setFibSettings(newSettings);
  };

  return (
    <div className="chart-panel">
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
        <span className="chart-mode-badge">Fibonacci</span>
        {fl && (
          <span className="chart-freshness" style={{ color: fl.color }}>
            ● {fl.text}
          </span>
        )}
        {syncAge && (
          <span className="chart-sync-age">Last sync: {syncAge}</span>
        )}
        <button
          className="chart-fib-settings-btn"
          onClick={() => setShowSettings(true)}
          title="Fib Settings"
        >
          ⚙
        </button>
      </div>

      <div className="chart-content-wrapper">
        <div className="chart-main">
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
            <button
              type="button"
              className="fib-action-button"
              onClick={() => setShowDrawings(!showDrawings)}
              title="Shortcut: Shift + D"
            >
              {showDrawings ? "Hide panel" : "Show panel"}
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

          {warning && (
            <div className="chart-warning">
              ⚠ {warning}
            </div>
          )}

          <div className="chart-canvas-container" ref={containerRef} style={{ position: "relative" }}>
            <ChartNotes
              symbol={symbol}
              panelType="fib"
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
            <div className="fib-drawing-list">
              <strong>Saved drawings</strong>
              {fibDrawings.map((drawing) => (
                <div key={drawing.id} className="fib-drawing-item" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
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
                  <div style={{ marginTop: '4px', display: 'flex', gap: '12px', fontSize: '0.85em', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="checkbox"
                        checked={!!drawing.extendRight}
                        onChange={(e) => handleUpdateDrawing(drawing.id, { extendRight: e.target.checked })}
                      />
                      Extend Right Edge
                    </label>
                    {!drawing.extendRight && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Extend by (bars):
                        <input
                          type="number"
                          min="0"
                          style={{ width: '50px' }}
                          value={drawing.extendToBars ?? 0}
                          onChange={(e) => handleUpdateDrawing(drawing.id, { extendToBars: parseInt(e.target.value) || 0 })}
                        />
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showSettings && (
        <FibSettingsWindow
          onClose={() => setShowSettings(false)}
          onSave={handleSettingsSave}
        />
      )}
    </div>
  );
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

    return drawings.map(drawing => ({
      ...drawing,
      type: drawing.type || 'retracement',
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
