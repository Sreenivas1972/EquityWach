import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
  UTCTimestamp,
} from "lightweight-charts";
import type { CandleData, EMASettings, Interval } from "../types";
import { toChartTime } from "../windows/shared";
import { api } from "../services/tauriApi";
import ChartNotes from "./ChartNotes";
import EMASettingsComponent from "./EMASettings";

interface Props {
  symbol: string | null;
  interval: Interval;
  candles: CandleData[];
  isLoading: boolean;
  freshness: string | null;
  lastSync: string | null;
  warning: string | null;
}

const DEFAULT_EMA_SETTINGS: EMASettings = {
  ema1_period: 20,
  ema2_period: 50,
  ema3_period: 200,
  ema1_color: "#f08c00",
  ema2_color: "#228be6",
  ema3_color: "#c2255c",
};

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
  const [emaSettings, setEMASettings] = useState<EMASettings>(DEFAULT_EMA_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const settingsVersionRef = useRef(0);

  useEffect(() => {
    api.getEMASettings()
      .then(setEMASettings)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const currentVersion = ++settingsVersionRef.current;

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

    const emaConfig = [
      { key: "ema1", period: emaSettings.ema1_period, color: emaSettings.ema1_color },
      { key: "ema2", period: emaSettings.ema2_period, color: emaSettings.ema2_color },
      { key: "ema3", period: emaSettings.ema3_period, color: emaSettings.ema3_color },
    ];

    const emaLines: Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>> = {};
    emaConfig.forEach(({ key, period, color }) => {
      emaLines[key] = chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: true,
        title: `EMA${period}`,
      });
    });

    if (currentVersion !== settingsVersionRef.current) {
      chart.remove();
      return;
    }

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
  }, [emaSettings]);

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

    const closePrices = candles.map((c) => c.close);
    const ema1 = calculateEMA(closePrices, emaSettings.ema1_period);
    const ema2 = calculateEMA(closePrices, emaSettings.ema2_period);
    const ema3 = calculateEMA(closePrices, emaSettings.ema3_period);

    const ema1Data = formatEMALine(formatted, ema1);
    const ema2Data = formatEMALine(formatted, ema2);
    const ema3Data = formatEMALine(formatted, ema3);

    if (emaSeriesRef.current.ema1) {
      emaSeriesRef.current.ema1.setData(ema1Data as Parameters<typeof emaSeriesRef.current.ema1.setData>[0]);
    }
    if (emaSeriesRef.current.ema2) {
      emaSeriesRef.current.ema2.setData(ema2Data as Parameters<typeof emaSeriesRef.current.ema2.setData>[0]);
    }
    if (emaSeriesRef.current.ema3) {
      emaSeriesRef.current.ema3.setData(ema3Data as Parameters<typeof emaSeriesRef.current.ema3.setData>[0]);
    }
  }, [candles, interval, emaSettings]);

  function handleSettingsSave(newSettings: EMASettings) {
    setEMASettings(newSettings);
  }

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
        <button
          className="chart-ema-settings-btn"
          onClick={() => setShowSettings(true)}
          title="EMA Settings"
        >
          ⚙
        </button>
      </div>

      {warning && (
        <div className="chart-warning">
          ⚠ {warning}
        </div>
      )}

      <div className="chart-canvas-container" ref={containerRef} style={{ position: "relative" }}>
        <ChartNotes
          symbol={symbol}
          panelType="ema"
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

      {showSettings && (
        <EMASettingsComponent
          onClose={() => setShowSettings(false)}
          onSave={handleSettingsSave}
        />
      )}
    </div>
  );
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
