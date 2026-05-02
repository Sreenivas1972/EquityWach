import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
  UTCTimestamp,
} from "lightweight-charts";
import { api } from "../services/tauriApi";
import type { CandleData, Interval, PivotSource, PriceAlert, SymbolSearchResult } from "../types";

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
  onFetch?: () => void;
  onSelectWatchlist?: (watchlistName: string, symbol: string) => void;
}

function BaseChartPanelComponent({
  symbol,
  interval,
  candles,
  isLoading,
  freshness,
  lastSync,
  warning,
  onFetch,
  onSelectWatchlist,
}: Props) {
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[] | null>(null);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSearchInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value.toUpperCase());
  }, []);

  const handleSearchKeyPress = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    const value = (e.currentTarget.value || "").trim();
    if (e.key === "Enter" && value) {
      try {
        const results = await api.searchSymbol(value);
        setSearchResults(results);
        setShowSearchResults(results.length > 0);
      } catch {
        setSearchResults(null);
        setShowSearchResults(false);
      }
    }
  }, []);

  const handleSelectWatchlist = useCallback((watchlistName: string, selectedSymbol: string) => {
    if (onSelectWatchlist) {
      onSelectWatchlist(watchlistName, selectedSymbol);
      setShowSearchResults(false);
      setSearchInput("");
    }
  }, [onSelectWatchlist]);

  const handleSelectSymbol = useCallback(async (selectedSymbol: string) => {
    setSearchInput(selectedSymbol);
    try {
      const results = await api.searchSymbol(selectedSymbol);
      setSearchResults(results);
      setShowSearchResults(results.length > 0);
    } catch {
      setSearchResults(null);
      setShowSearchResults(false);
    }
  }, []);

  const handleSearchFocus = useCallback(() => {
    if (showSearchResults && searchResults) {
      setShowSearchResults(true);
    }
  }, [showSearchResults, searchResults]);

  const handleSearchBlur = useCallback(() => {
    setTimeout(() => setShowSearchResults(false), 200);
  }, []);

  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ReturnType<
    ReturnType<typeof createChart>["addSeries"]
  > | null>(null);
  const pivotSeriesRef = useRef<Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>>>({});
  const pivotSourceRef = useRef<PivotSource | null>(null);
  const crosshairPriceRef = useRef<number | null>(null);
  const alertSeriesRef = useRef<Record<string, any>>({});

  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [chartHeight, setChartHeight] = useState(0);

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

    const pivotLines: Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>> = {};
    CAMARILLA_LEVELS.forEach((level) => {
      pivotLines[level.key] = chart.addSeries(LineSeries, {
        color: level.color,
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: level.label,
        autoscaleInfoProvider: () => ({
          priceRange: null, // This series will now be ignored for autoscaling
        }),

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

  // ── Track crosshair price ─────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handleCrosshairMove = (param: any) => {
      if (!param.point || !seriesRef.current) return;
      const price = seriesRef.current.coordinateToPrice(param.point.y);
      if (price !== null && price !== undefined && !Number.isNaN(price)) {
        crosshairPriceRef.current = price as number;
      }
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
    };
  }, []);

  // ── Keyboard shortcut for price alert ─────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        if (!symbol || candles.length === 0) return;
        const targetPrice = crosshairPriceRef.current;
        if (targetPrice === null || targetPrice === undefined) return;

        const latestClose = candles[candles.length - 1].close;
        const direction = latestClose > targetPrice ? "below" : "above";

        api.addPriceAlert(symbol, targetPrice, direction).then(() => {
          api.getPriceAlerts(symbol).then(setAlerts).catch(() => {});
        }).catch(() => {});
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [symbol, candles]);

  // ── Fetch alerts when symbol changes ──────────────────────────────────────
  useEffect(() => {
    if (!symbol) {
      setAlerts([]);
      return;
    }
    api.getPriceAlerts(symbol).then(setAlerts).catch(() => {});
  }, [symbol]);

  // ── Track chart container height for alert button positioning ─────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    const observer = new ResizeObserver(() => {
      setChartHeight(el.clientHeight);
    });
    observer.observe(el);
    setChartHeight(el.clientHeight);

    return () => observer.disconnect();
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
      const drawFromTs = getPivotDrawFrom(interval, candles) ?? pivotSrc.draw_from;

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

        // Add anchor point at draw_from to prevent line extension to the left
        if (lineData.length > 0) {
          const firstPointTime = lineData[0].time;
          if (typeof firstPointTime === "string" ? parseDateString(firstPointTime) > drawFromTs : firstPointTime > drawFromTs) {
            // Insert anchor point at draw_from
            lineData.unshift({
              time: typeof firstPointTime === "string" ? convertTimestampToDateString(drawFromTs) : (drawFromTs as UTCTimestamp),
              value,
            });
          }
        }
        line.setData(lineData as Parameters<typeof line.setData>[0]);
      });
    } else {
      CAMARILLA_LEVELS.forEach((level) => {
        pivotSeriesRef.current[level.key]?.setData([]);
      });
    }
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

  // ── Render alert lines ───────────────────────────────────────────────────
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;

    Object.values(alertSeriesRef.current).forEach((line) => {
      try { seriesRef.current!.removePriceLine(line); } catch {}
    });
    alertSeriesRef.current = {};

    alerts.forEach((alert) => {
      const color = alert.direction === "above" ? "#22c55e" : "#ef4444";

      try {
        const lineId = seriesRef.current!.createPriceLine({
          price: alert.target_price,
          color,
          lineWidth: 1,
          lineStyle: 3,
          axisLabelVisible: true,
        });
        alertSeriesRef.current[alert.id] = lineId;
      } catch {}
    });
  }, [alerts]);

  const handleDeleteAlert = useCallback((id: string) => {
    api.deletePriceAlert(id).then(() => {
      if (symbol) {
        api.getPriceAlerts(symbol).then(setAlerts).catch(() => {});
      }
    }).catch(() => {});
  }, [symbol]);

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
        <div className="chart-search-container">
          <input
            type="text"
            className="chart-search-input"
            placeholder="Search symbol..."
            value={searchInput}
            onChange={handleSearchInputChange}
            onKeyPress={handleSearchKeyPress}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
          />
          {showSearchResults && searchResults && searchResults.length > 1 && (
            <div className="chart-search-results">
              {searchResults.map((result) => (
                <div
                  key={result.symbol}
                  className="chart-search-result-item"
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent onBlur before click registers
                    handleSelectSymbol(result.symbol);
                  }}
                >
                  {result.symbol}
                </div>
              ))}
            </div>
          )}
          {showSearchResults && searchResults && searchResults.length === 1 && searchResults[0].watchlists.length > 0 && (
            <div className="chart-search-results">
              {searchResults[0].watchlists.map((watchlistName) => (
                <div
                  key={watchlistName}
                  className="chart-search-result-item"
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent onBlur before click registers
                    handleSelectWatchlist(watchlistName, searchResults[0].symbol);
                  }}
                >
                  {watchlistName}
                </div>
              ))}
            </div>
          )}
        </div>
        {symbol && onFetch && (
          <span className="chart-sync-actions">
            <button
              type="button"
              className="chart-fetch-button"
              onClick={onFetch}
              disabled={isLoading}
            >
              Fetch
            </button>
            {syncAge && (
              <span className="chart-sync-age">Last sync: {syncAge}</span>
            )}
          </span>
        )}
      </div>

      {/* Warning banner */}
      {warning && (
        <div className="chart-warning">
          ⚠ {warning}
        </div>
      )}

      {/* Chart area */}
      <div className="chart-canvas-container" ref={containerRef} style={{ position: "relative" }}>
        {alerts.length > 0 && (
          <div className="alert-buttons-overlay" style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            pointerEvents: "none",
            zIndex: 10,
            height: chartHeight || "100%",
          }}>
            {alerts.map((alert) => {
              const color = alert.direction === "above" ? "#22c55e" : "#ef4444";
              const y = seriesRef.current?.priceToCoordinate(alert.target_price);
              if (y === null || y === undefined) return null;
              return (
                <div
                  key={alert.id}
                  className="alert-button-wrapper"
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: y,
                    pointerEvents: "auto",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleDeleteAlert(alert.id)}
                    style={{
                      background: color,
                      color: "#fff",
                      border: "2px solid #fff",
                      borderRadius: 3,
                      width: 18,
                      height: 18,
                      fontSize: 11,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                      padding: 0,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                    }}
                    title={`Delete alert @ ${alert.target_price} (${alert.direction})`}
                  >
                    x
                  </button>
                </div>
              );
            })}
          </div>
        )}
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

const BaseChartPanel = memo(BaseChartPanelComponent);
export default BaseChartPanel;

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

function getPivotDrawFrom(interval: Interval, candles: CandleData[]): number | null {
  if (candles.length === 0) {
    return null;
  }

  const lastTs = candles[candles.length - 1].time;
  const lastDate = new Date(lastTs * 1000);
  const year = lastDate.getUTCFullYear();

  if (interval === "day") {
    return Date.UTC(year, lastDate.getUTCMonth(), 1, 0, 0, 0) / 1000;
  }

  if (interval === "week") {
    const quarterStartMonth = Math.floor(lastDate.getUTCMonth() / 3) * 3;
    return Date.UTC(year, quarterStartMonth, 1, 0, 0, 0) / 1000;
  }

  return null;
}

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

function convertTimestampToDateString(ts: number): string {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
