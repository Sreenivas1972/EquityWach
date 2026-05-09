import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
  UTCTimestamp,
} from "lightweight-charts";
import { api } from "../services/tauriApi";
import type { CandleData, ChartNote, Interval, LongPosition, PivotSource, PriceAlert, SymbolSearchResult } from "../types";
import { toChartTime } from "../windows/shared";

type PivotType = 'camarilla' | 'standard' | 'none';

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

type StandardLevelMeta = {
  key: string;
  label: string;
  color: string;
  compute: (high: number, low: number, close: number) => number;
};

const STANDARD_LEVELS: StandardLevelMeta[] = [
  { key: "R5", label: "R5", color: "#a61e4d", compute: (high, low, close) => (high + low + close) / 3 + 4 * (high - low) },
  { key: "R4", label: "R4", color: "#c2255c", compute: (high, low, close) => (high + low + close) / 3 + 3 * (high - low) },
  { key: "R3", label: "R3", color: "#d9480f", compute: (high, low, close) => (high + low + close) / 3 + 2 * (high - low) },
  { key: "R2", label: "R2", color: "#f08c00", compute: (high, low, close) => (high + low + close) / 3 + (high - low) },
  { key: "R1", label: "R1", color: "#fab005", compute: (high, low, close) => 2 * ((high + low + close) / 3) - low },
  { key: "PP", label: "PP", color: "#228be6", compute: (high, low, close) => (high + low + close) / 3 },
  { key: "S1", label: "S1", color: "#82c91e", compute: (high, low, close) => 2 * ((high + low + close) / 3) - high },
  { key: "S2", label: "S2", color: "#40c057", compute: (high, low, close) => (high + low + close) / 3 - (high - low) },
  { key: "S3", label: "S3", color: "#12b886", compute: (high, low, close) => (high + low + close) / 3 - 2 * (high - low) },
  { key: "S4", label: "S4", color: "#0ca678", compute: (high, low, close) => (high + low + close) / 3 - 3 * (high - low) },
  { key: "S5", label: "S5", color: "#087f5b", compute: (high, low, close) => (high + low + close) / 3 - 4 * (high - low) },
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
  const standardPivotSeriesRef = useRef<Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>>>({});
  const pivotSourceRef = useRef<PivotSource | null>(null);
  const crosshairPriceRef = useRef<number | null>(null);
  const alertSeriesRef = useRef<Record<string, any>>({});

  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [chartHeight, setChartHeight] = useState(0);
  const [pivotType, setPivotType] = useState<PivotType>('camarilla');

  const [longPositions, setLongPositions] = useState<LongPosition[]>([]);
  const positionSeriesRef = useRef<Record<string, { sl: any; target: any }>>({});
  
  const [notes, setNotes] = useState<ChartNote[]>([]);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [hashtagSuggestions, setHashtagSuggestions] = useState<string[]>([]);
  const [showHashtagSuggestions, setShowHashtagSuggestions] = useState(false);
  const [hashtagCaretPos, setHashtagCaretPos] = useState(0);
  const [currentHashtagStart, setCurrentHashtagStart] = useState<number | null>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const noteModalRef = useRef<HTMLDivElement>(null);
  const crosshairTimeRef = useRef<number | null>(null);
  const pendingNoteAnchorRef = useRef<{ anchorTime: number; anchorPrice: number } | null>(null);

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
          priceRange: null,
        }),
      });
    });

    const standardPivotLines: Record<string, ReturnType<ReturnType<typeof createChart>["addSeries"]>> = {};
    STANDARD_LEVELS.forEach((level) => {
      standardPivotLines[level.key] = chart.addSeries(LineSeries, {
        color: level.color,
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: level.label,
        autoscaleInfoProvider: () => ({
          priceRange: null,
        }),
      });
    });

    chartRef.current = chart;
    seriesRef.current = series;
    pivotSeriesRef.current = pivotLines;
    standardPivotSeriesRef.current = standardPivotLines;

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
      standardPivotSeriesRef.current = {};
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
      if (param.time) {
        crosshairTimeRef.current = param.time as number;
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

  // ── Keyboard shortcut for long position tool (Cmd+B) ───────────────────────
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        if (!symbol || candles.length === 0) return;
        
        const crosshairPrice = crosshairPriceRef.current;
        const entryPrice = crosshairPrice !== null && crosshairPrice !== undefined 
          ? crosshairPrice 
          : candles[candles.length - 1].close;
        
        const slPrice = entryPrice * 0.95;
        const targetPrice = entryPrice * 1.10;
        const entryTime = candles[candles.length - 1].time;
        
        try {
          const id = await api.addLongPosition(symbol, entryPrice, slPrice, targetPrice, entryTime, interval);
          const newPosition: LongPosition = {
            id,
            symbol,
            entry_price: entryPrice,
            sl_price: slPrice,
            target_price: targetPrice,
            entry_time: entryTime,
            interval,
            created_at: new Date().toISOString(),
          };
          setLongPositions(prev => [...prev, newPosition]);
        } catch (err) {
          console.error('Failed to save position:', err);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [symbol, candles, interval]);

  // ── Keyboard shortcut for notes (Cmd+N) ────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        if (!symbol || candles.length === 0) return;
        
        const crosshairPrice = crosshairPriceRef.current;
        const crosshairTime = crosshairTimeRef.current;
        
        const anchorPrice = crosshairPrice !== null && crosshairPrice !== undefined 
          ? crosshairPrice 
          : candles[candles.length - 1].close;
        
        const anchorTime = crosshairTime !== null && crosshairTime !== undefined
          ? crosshairTime
          : candles[candles.length - 1].time;
        
        pendingNoteAnchorRef.current = { anchorTime, anchorPrice };
        
        setEditingNoteId(null);
        setNoteText("");
        setShowNoteModal(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [symbol, candles]);

  // ── Fetch alerts when candles are loaded ────────────────────────────────
  useEffect(() => {
    if (!symbol) {
      setAlerts([]);
      return;
    }
    api.getPriceAlerts(symbol).then(setAlerts).catch(() => {});
  }, [candles]);

  // ── Fetch notes when symbol changes ─────────────────────────────────────
  useEffect(() => {
    if (!symbol) {
      setNotes([]);
      return;
    }
    api.getChartNotes(symbol).then(setNotes).catch(() => {});
  }, [symbol]);

  // ── Fetch hashtags on mount ─────────────────────────────────────────────
  useEffect(() => {
    api.getAllHashtags().then(setHashtags).catch(() => {});
  }, []);

  // ── Fetch long positions when symbol/interval changes ────────────────────
  useEffect(() => {
    if (!symbol) {
      setLongPositions([]);
      return;
    }
    api.getLongPositions(symbol, interval).then(setLongPositions).catch(() => {});
  }, [symbol, interval]);

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
      STANDARD_LEVELS.forEach((level) => {
        standardPivotSeriesRef.current[level.key]?.setData([]);
      });
      return;
    }

    if (candles.length >= 2 && pivotSourceRef.current) {
      const pivotSrc = pivotSourceRef.current;
      const high = pivotSrc.high;
      const low = pivotSrc.low;
      const close = pivotSrc.close;
      const drawFromTs = getPivotDrawFrom(interval, candles) ?? pivotSrc.draw_from;

      if (pivotType === 'camarilla') {
        STANDARD_LEVELS.forEach((level) => {
          standardPivotSeriesRef.current[level.key]?.setData([]);
        });
        
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

          if (lineData.length > 0) {
            const firstPointTime = lineData[0].time;
            if (typeof firstPointTime === "string" ? parseDateString(firstPointTime) > drawFromTs : firstPointTime > drawFromTs) {
              lineData.unshift({
                time: typeof firstPointTime === "string" ? convertTimestampToDateString(drawFromTs) : (drawFromTs as UTCTimestamp),
                value,
              });
            }
          }
          line.setData(lineData as Parameters<typeof line.setData>[0]);
        });
      } else if (pivotType === 'standard') {
        CAMARILLA_LEVELS.forEach((level) => {
          pivotSeriesRef.current[level.key]?.setData([]);
        });
        
        STANDARD_LEVELS.forEach((level) => {
          const value = low > 0 ? level.compute(high, low, close) : NaN;
          const line = standardPivotSeriesRef.current[level.key];
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

          if (lineData.length > 0) {
            const firstPointTime = lineData[0].time;
            if (typeof firstPointTime === "string" ? parseDateString(firstPointTime) > drawFromTs : firstPointTime > drawFromTs) {
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
        STANDARD_LEVELS.forEach((level) => {
          standardPivotSeriesRef.current[level.key]?.setData([]);
        });
      }
    } else {
      CAMARILLA_LEVELS.forEach((level) => {
        pivotSeriesRef.current[level.key]?.setData([]);
      });
      STANDARD_LEVELS.forEach((level) => {
        standardPivotSeriesRef.current[level.key]?.setData([]);
      });
    }
  }, [candles, interval, pivotType]);

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

  // ── Render long position lines ───────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current || candles.length === 0) {
      Object.values(positionSeriesRef.current).forEach((series) => {
        try { series.sl?.setData([]); } catch {}
        try { series.target?.setData([]); } catch {}
      });
      positionSeriesRef.current = {};
      return;
    }

    if (longPositions.length === 0) {
      Object.values(positionSeriesRef.current).forEach((series) => {
        try { series.sl?.setData([]); } catch {}
        try { series.target?.setData([]); } catch {}
      });
      positionSeriesRef.current = {};
      return;
    }

    const chart = chartRef.current;
    const formatted = candles.map((c) => ({
      time: toChartTime(c.time, interval),
    }));

    longPositions.forEach((position) => {
      const entryTimeChart = toChartTime(position.entry_time, interval);

      const slData = formatted
        .filter((point) => {
          const pointTs = typeof point.time === "string" ? parseDateString(point.time) : point.time;
          const entryTs = typeof entryTimeChart === "string" ? parseDateString(entryTimeChart) : entryTimeChart;
          return pointTs >= entryTs;
        })
        .map((point) => ({
          time: point.time,
          value: position.sl_price,
        }));

      const targetData = formatted
        .filter((point) => {
          const pointTs = typeof point.time === "string" ? parseDateString(point.time) : point.time;
          const entryTs = typeof entryTimeChart === "string" ? parseDateString(entryTimeChart) : entryTimeChart;
          return pointTs >= entryTs;
        })
        .map((point) => ({
          time: point.time,
          value: position.target_price,
        }));

      if (!positionSeriesRef.current[position.id]) {
        positionSeriesRef.current[position.id] = {
          sl: chart.addSeries(LineSeries, {
            color: "#ef4444",
            lineWidth: 2,
            lineStyle: 0,
            priceLineVisible: true,
            lastValueVisible: true,
            crosshairMarkerVisible: false,
            title: "SL",
          }),
          target: chart.addSeries(LineSeries, {
            color: "#22c55e",
            lineWidth: 2,
            lineStyle: 0,
            priceLineVisible: true,
            lastValueVisible: true,
            crosshairMarkerVisible: false,
            title: "Target",
          }),
        };
      }

      try {
        positionSeriesRef.current[position.id].sl.setData(slData as any);
        positionSeriesRef.current[position.id].target.setData(targetData as any);
      } catch {}
    });

    return () => {
      Object.values(positionSeriesRef.current).forEach((series) => {
        try { series.sl?.setData([]); } catch {}
        try { series.target?.setData([]); } catch {}
      });
    };
  }, [longPositions, candles, interval]);

  const handleDeleteAlert = useCallback((id: string) => {
    api.deletePriceAlert(id).then(() => {
      if (symbol) {
        api.getPriceAlerts(symbol).then(setAlerts).catch(() => {});
      }
    }).catch(() => {});
  }, [symbol]);

  const handleClearPosition = useCallback(async (id: string) => {
    try {
      await api.deleteLongPosition(id);
      setLongPositions(prev => prev.filter(p => p.id !== id));
    } catch (e) {
      console.error('Failed to delete position:', e);
    }
  }, []);

  const handleDragPreview = useCallback((id: string, type: 'sl' | 'target', newPrice: number) => {
    setLongPositions(prev => prev.map(p => 
      p.id === id 
        ? { ...p, [type === 'sl' ? 'sl_price' : 'target_price']: newPrice }
        : p
    ));
  }, []);

  const handleDragCommit = useCallback(async (id: string, slPrice: number, targetPrice: number) => {
    try {
      await api.updateLongPosition(id, slPrice, targetPrice);
    } catch (e) {
      console.error('Failed to update position:', e);
    }
  }, []);

  // ── Note handlers ─────────────────────────────────────────────────────────
  const handleSaveNote = useCallback(async () => {
    if (!symbol || candles.length === 0 || !noteText.trim()) return;
    
    try {
      if (editingNoteId) {
        await api.updateChartNote(editingNoteId, noteText, null, null);
        setNotes(prev => prev.map(n => 
          n.id === editingNoteId ? { ...n, note_text: noteText } : n
        ));
      } else {
        const pending = pendingNoteAnchorRef.current;
        const anchorPrice = pending?.anchorPrice ?? candles[candles.length - 1].close;
        const anchorTime = pending?.anchorTime ?? candles[candles.length - 1].time;
        
        const id = await api.addChartNote(symbol, noteText, anchorTime, anchorPrice);
        const newNote: ChartNote = {
          id,
          symbol,
          note_text: noteText,
          anchor_time: anchorTime,
          anchor_price: anchorPrice,
          pos_x: null,
          pos_y: null,
          created_at: new Date().toISOString(),
        };
        setNotes(prev => [...prev, newNote]);
      }
      setShowNoteModal(false);
      setNoteText("");
      setEditingNoteId(null);
      pendingNoteAnchorRef.current = null;
      
      const updatedHashtags = await api.getAllHashtags();
      setHashtags(updatedHashtags);
    } catch (e) {
      console.error('Failed to save note:', e);
    }
  }, [symbol, candles, noteText, editingNoteId]);

  const handleDeleteNote = useCallback(async (id: string) => {
    try {
      await api.deleteChartNote(id);
      setNotes(prev => prev.filter(n => n.id !== id));
    } catch (e) {
      console.error('Failed to delete note:', e);
    }
  }, []);

  const handleNotePositionUpdate = useCallback(async (id: string, posX: number, posY: number) => {
    try {
      await api.updateChartNotePosition(id, posX, posY);
      setNotes(prev => prev.map(n => 
        n.id === id ? { ...n, pos_x: posX, pos_y: posY } : n
      ));
    } catch (e) {
      console.error('Failed to update note position:', e);
    }
  }, []);

  const handleEditNote = useCallback((note: ChartNote) => {
    setEditingNoteId(note.id);
    setNoteText(note.note_text);
    setShowNoteModal(true);
  }, []);

  // ── Hashtag autocomplete ───────────────────────────────────────────────────
  const handleNoteTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    const caretPos = e.target.selectionStart || 0;
    setNoteText(text);
    
    const textBeforeCaret = text.substring(0, caretPos);
    const lastHashIndex = textBeforeCaret.lastIndexOf('#');
    
    if (lastHashIndex !== -1) {
      const textAfterHash = textBeforeCaret.substring(lastHashIndex + 1);
      if (!textAfterHash.includes(' ') && !textAfterHash.includes('\n')) {
        const partialTag = textAfterHash.toLowerCase();
        const suggestions = hashtags.filter(h => 
          h.toLowerCase().startsWith(partialTag) && h.toLowerCase() !== partialTag
        );
        setHashtagSuggestions(suggestions);
        setShowHashtagSuggestions(suggestions.length > 0);
        setCurrentHashtagStart(lastHashIndex);
        setHashtagCaretPos(caretPos);
        return;
      }
    }
    
    setShowHashtagSuggestions(false);
    setCurrentHashtagStart(null);
  }, [hashtags]);

  const handleSelectHashtag = useCallback((tag: string) => {
    if (currentHashtagStart === null) return;
    
    const beforeHash = noteText.substring(0, currentHashtagStart);
    const afterCaret = noteText.substring(hashtagCaretPos);
    const newText = beforeHash + '#' + tag + ' ' + afterCaret;
    setNoteText(newText);
    setShowHashtagSuggestions(false);
    setCurrentHashtagStart(null);
    
    setTimeout(() => {
      const newCaretPos = beforeHash.length + tag.length + 2;
      noteInputRef.current?.setSelectionRange(newCaretPos, newCaretPos);
      noteInputRef.current?.focus();
    }, 0);
  }, [noteText, currentHashtagStart, hashtagCaretPos]);

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
        <select
          className="chart-pivot-select"
          value={pivotType}
          onChange={(e) => setPivotType(e.target.value as PivotType)}
        >
          <option value="camarilla">Camarilla</option>
          <option value="standard">Standard</option>
          <option value="none">No Pivots</option>
        </select>
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
        {longPositions.length > 0 && seriesRef.current && (
          <div className="position-drag-handles" style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            pointerEvents: "none",
            zIndex: 15,
          }}>
            {longPositions.map((position) => (
              <div key={position.id}>
                {/* SL Drag Handle */}
                {(() => {
                  const y = seriesRef.current?.priceToCoordinate(position.sl_price);
                  if (y === null || y === undefined) return null;
                  return (
                    <div
                      style={{
                        position: "absolute",
                        right: 50,
                        top: y - 12,
                        pointerEvents: "auto",
                        cursor: "ns-resize",
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const container = containerRef.current;
                        if (!container || !seriesRef.current) return;
                        
                        const handleMouseMove = (moveEvent: MouseEvent) => {
                          const rect = container.getBoundingClientRect();
                          const y = moveEvent.clientY - rect.top;
                          const price = seriesRef.current?.coordinateToPrice(y);
                          if (price !== null && price !== undefined) {
                            handleDragPreview(position.id, 'sl', price);
                          }
                        };
                        
                        const handleMouseUp = () => {
                          window.removeEventListener('mousemove', handleMouseMove);
                          window.removeEventListener('mouseup', handleMouseUp);
                          const pos = longPositions.find(p => p.id === position.id);
                          if (pos) {
                            handleDragCommit(position.id, pos.sl_price, pos.target_price);
                          }
                        };
                        
                        window.addEventListener('mousemove', handleMouseMove);
                        window.addEventListener('mouseup', handleMouseUp);
                      }}
                    >
                      <div style={{
                        background: "#ef4444",
                        color: "#fff",
                        border: "2px solid #fff",
                        borderRadius: 4,
                        padding: "4px 8px",
                        fontSize: 11,
                        fontWeight: "bold",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
                        userSelect: "none",
                      }}>
                        SL: {position.sl_price.toFixed(2)}
                      </div>
                    </div>
                  );
                })()}
                
                {/* Target Drag Handle */}
                {(() => {
                  const y = seriesRef.current?.priceToCoordinate(position.target_price);
                  if (y === null || y === undefined) return null;
                  return (
                    <div
                      style={{
                        position: "absolute",
                        right: 50,
                        top: y - 12,
                        pointerEvents: "auto",
                        cursor: "ns-resize",
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const container = containerRef.current;
                        if (!container || !seriesRef.current) return;
                        
                        const handleMouseMove = (moveEvent: MouseEvent) => {
                          const rect = container.getBoundingClientRect();
                          const y = moveEvent.clientY - rect.top;
                          const price = seriesRef.current?.coordinateToPrice(y);
                          if (price !== null && price !== undefined) {
                            handleDragPreview(position.id, 'target', price);
                          }
                        };
                        
                        const handleMouseUp = () => {
                          window.removeEventListener('mousemove', handleMouseMove);
                          window.removeEventListener('mouseup', handleMouseUp);
                          const pos = longPositions.find(p => p.id === position.id);
                          if (pos) {
                            handleDragCommit(position.id, pos.sl_price, pos.target_price);
                          }
                        };
                        
                        window.addEventListener('mousemove', handleMouseMove);
                        window.addEventListener('mouseup', handleMouseUp);
                      }}
                    >
                      <div style={{
                        background: "#22c55e",
                        color: "#fff",
                        border: "2px solid #fff",
                        borderRadius: 4,
                        padding: "4px 8px",
                        fontSize: 11,
                        fontWeight: "bold",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
                        userSelect: "none",
                      }}>
                        TGT: {position.target_price.toFixed(2)}
                      </div>
                    </div>
                  );
                })()}
                
                {/* Clear Position Button for this position */}
                {(() => {
                  const y = seriesRef.current?.priceToCoordinate(position.entry_price);
                  if (y === null || y === undefined) return null;
                  return (
                    <div style={{
                      position: "absolute",
                      right: 50,
                      top: y - 12,
                      pointerEvents: "auto",
                    }}>
                      <button
                        onClick={() => handleClearPosition(position.id)}
                        style={{
                          background: "#6b7280",
                          color: "#fff",
                          border: "none",
                          borderRadius: 4,
                          padding: "4px 8px",
                          fontSize: 11,
                          cursor: "pointer",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                        }}
                        title="Remove this position"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
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
                    right: "20",
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
        {notes.length > 0 && chartRef.current && (
          <div className="notes-overlay" style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            pointerEvents: "none",
            zIndex: 12,
          }}>
            {notes.map((note) => {
              const chart = chartRef.current;
              if (!chart) return null;
              
              const timeScale = chart.timeScale();
              const coordinate = timeScale.timeToCoordinate(note.anchor_time as UTCTimestamp);
              const priceY = seriesRef.current?.priceToCoordinate(note.anchor_price);
              
              if (coordinate === null || priceY === null || priceY === undefined) return null;
              
              const noteX = note.pos_x !== null ? note.pos_x : coordinate + 20;
              const noteY = note.pos_y !== null ? note.pos_y : priceY - 20;
              
              return (
                <div
                  key={note.id}
                  style={{
                    position: "absolute",
                    left: noteX,
                    top: noteY,
                    pointerEvents: "auto",
                    cursor: "move",
                    maxWidth: 250,
                  }}
                  onMouseDown={(e) => {
                    if (e.target instanceof HTMLButtonElement) return;
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const startNoteX = noteX;
                    const startNoteY = noteY;
                    
                    const handleMouseMove = (moveEvent: MouseEvent) => {
                      const deltaX = moveEvent.clientX - startX;
                      const deltaY = moveEvent.clientY - startY;
                      const newX = startNoteX + deltaX;
                      const newY = startNoteY + deltaY;
                      
                      setNotes(prev => prev.map(n => 
                        n.id === note.id ? { ...n, pos_x: newX, pos_y: newY } : n
                      ));
                    };
                    
                    const handleMouseUp = () => {
                      window.removeEventListener('mousemove', handleMouseMove);
                      window.removeEventListener('mouseup', handleMouseUp);
                      
                      const finalNote = notes.find(n => n.id === note.id);
                      if (finalNote) {
                        const deltaX = finalNote.pos_x !== null ? finalNote.pos_x - noteX : 0;
                        const deltaY = finalNote.pos_y !== null ? finalNote.pos_y - noteY : 0;
                        handleNotePositionUpdate(note.id, startNoteX + deltaX, startNoteY + deltaY);
                      }
                    };
                    
                    window.addEventListener('mousemove', handleMouseMove);
                    window.addEventListener('mouseup', handleMouseUp);
                  }}
                >
                  <div style={{
                    background: "rgba(59, 130, 246, 0.95)",
                    color: "#fff",
                    border: "2px solid #fff",
                    borderRadius: 6,
                    padding: "8px 10px",
                    fontSize: 12,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                    userSelect: "none",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}>
                    {note.note_text.split(/(#\w+)/g).map((part, i) => 
                      part.startsWith('#') 
                        ? <span key={i} style={{ color: '#fbbf24', fontWeight: 'bold' }}>{part}</span>
                        : part
                    )}
                    <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditNote(note);
                        }}
                        style={{
                          background: "rgba(255,255,255,0.2)",
                          color: "#fff",
                          border: "none",
                          borderRadius: 3,
                          padding: "2px 6px",
                          fontSize: 10,
                          cursor: "pointer",
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNote(note.id);
                        }}
                        style={{
                          background: "rgba(239, 68, 68, 0.8)",
                          color: "#fff",
                          border: "none",
                          borderRadius: 3,
                          padding: "2px 6px",
                          fontSize: 10,
                          cursor: "pointer",
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {showNoteModal && (
          <div
            ref={noteModalRef}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "#fff",
              border: "1px solid #d4deea",
              borderRadius: 8,
              padding: 16,
              zIndex: 100,
              boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
              minWidth: 320,
            }}
          >
            <h3 style={{ margin: "0 0 12px 0", fontSize: 14, color: "#1f2937" }}>
              {editingNoteId ? "Edit Note" : "Add Note"}
            </h3>
            <div style={{ position: "relative" }}>
              <textarea
                ref={noteInputRef}
                value={noteText}
                onChange={handleNoteTextChange}
                placeholder="Enter note text... Use # for hashtags"
                style={{
                  width: "100%",
                  height: 80,
                  padding: 8,
                  border: "1px solid #d4deea",
                  borderRadius: 4,
                  fontSize: 13,
                  resize: "none",
                  outline: "none",
                  fontFamily: "inherit",
                }}
                autoFocus
              />
              {showHashtagSuggestions && hashtagSuggestions.length > 0 && (
                <div style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  background: "#fff",
                  border: "1px solid #d4deea",
                  borderRadius: 4,
                  maxHeight: 120,
                  overflowY: "auto",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                  zIndex: 10,
                }}>
                  {hashtagSuggestions.map((tag) => (
                    <div
                      key={tag}
                      onClick={() => handleSelectHashtag(tag)}
                      style={{
                        padding: "6px 10px",
                        cursor: "pointer",
                        fontSize: 12,
                        borderBottom: "1px solid #f0f0f0",
                      }}
                      onMouseEnter={(e) => {
                        (e.target as HTMLDivElement).style.background = "#f3f4f6";
                      }}
                      onMouseLeave={(e) => {
                        (e.target as HTMLDivElement).style.background = "transparent";
                      }}
                    >
                      #{tag}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  setShowNoteModal(false);
                  setNoteText("");
                  setEditingNoteId(null);
                }}
                style={{
                  padding: "6px 12px",
                  border: "1px solid #d4deea",
                  borderRadius: 4,
                  background: "#fff",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNote}
                disabled={!noteText.trim()}
                style={{
                  padding: "6px 12px",
                  border: "none",
                  borderRadius: 4,
                  background: noteText.trim() ? "#3b82f6" : "#d4deea",
                  color: "#fff",
                  cursor: noteText.trim() ? "pointer" : "not-allowed",
                  fontSize: 12,
                }}
              >
                {editingNoteId ? "Update" : "Save"}
              </button>
            </div>
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
