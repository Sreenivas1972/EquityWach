import { useCallback, useEffect, useMemo, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./App.css";
import BaseChartPanel from "./components/BaseChartPanel";
import SRChartPanel from "./components/SRChartPanel";
import EMAChartPanel from "./components/EMAChartPanel";
import FibChartPanel from "./components/FibChartPanel";
import ColorFilterPanel from "./components/ColorFilterPanel";
import VisitedSymbolTracker from "./components/VisitedSymbolTracker";
import NewsPanel from "./components/NewsPanel";
import SettingsPanel from "./components/SettingsPanel";
import WatchlistPanel from "./components/WatchlistPanel";
import WatchlistPicker from "./components/WatchlistPicker";
import { useNews } from "./hooks/useNews";
import { api } from "./services/tauriApi";
import type { CandleData, ColorFilteredSymbol, Interval, WatchlistEntry, WatchlistSymbol } from "./types";
import { SYMBOL_SYNC_EVENT, VISITED_SYMBOLS_EVENT, type SymbolSyncPayload, type VisitedSymbol } from "./windows/shared";

// ─── Watchlist sort helpers ───────────────────────────────────────────────────

export type SortMode = 'alpha' | 'color' | 'tag_color';

const COLOR_RANK: Record<string, number> = {
  red: 0,
  yellow: 1,
  green: 2,
};

const TAG_COLOR_RANK: Record<string, number> = {
  violet: 0,
  indigo: 1,
  blue: 2,
  orange: 3,
  pink: 4,
};

function sortSymbols(syms: WatchlistSymbol[], mode: SortMode): WatchlistSymbol[] {
  return [...syms].sort((a, b) => {
    if (mode === 'color') {
      const cA = a.color ? (COLOR_RANK[a.color] ?? 98) : 99;
      const cB = b.color ? (COLOR_RANK[b.color] ?? 98) : 99;
      if (cA !== cB) return cA - cB;
    } else if (mode === 'tag_color') {
      const tA = a.tag_color ? (TAG_COLOR_RANK[a.tag_color] ?? 98) : 99;
      const tB = b.tag_color ? (TAG_COLOR_RANK[b.tag_color] ?? 98) : 99;
      if (tA !== tB) return tA - tB;
    }
    // alpha (and tie-break for color/tag_color modes)
    return a.symbol.localeCompare(b.symbol);
  });
}

export type DetachedWindowMode = "fib" | "ema" | "sr" | "colorfilter" | "visited";

// Get window mode from URL if present
const params = new URLSearchParams(window.location.search);
const urlMode = params.get("mode") as DetachedWindowMode | null;

export default function App() {
  const [view, setView] = useState<"chart" | "settings">("chart");
  const [mode] = useState<DetachedWindowMode | null>(urlMode);

  const [watchlists, setWatchlists] = useState<WatchlistEntry[]>([]);
  const [selectedWatchlist, setSelectedWatchlist] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<WatchlistSymbol[]>([]);
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('alpha');

  const sortedSymbols = useMemo(
    () => sortSymbols(symbols, sortMode),
    [symbols, sortMode]
  );

  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [interval, setInterval] = useState<Interval>("day");
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [isLoadingChart, setIsLoadingChart] = useState(false);
  const [freshness, setFreshness] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [chartWarning, setChartWarning] = useState<string | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [lastPickedWatchlist, setLastPickedWatchlist] = useState<string | null>(null);

  const [isNewsOpen, setIsNewsOpen] = useState(false);

  const [colorFilterMode, setColorFilterMode] = useState(false);
  const [colorFilterValue, setColorFilterValue] = useState<{ color: string | null; tagColor: string | null }>({ color: null, tagColor: null });
  const [colorFilterType, setColorFilterType] = useState<'color' | 'alerts' | 'positions'>('color');
  const [colorFilteredSymbols, setColorFilteredSymbols] = useState<ColorFilteredSymbol[]>([]);
  const [isLoadingColorFilter, setIsLoadingColorFilter] = useState(false);

  const [visitedSymbols, setVisitedSymbols] = useState<VisitedSymbol[]>([]);

  const { isLoading: isLoadingNews, error: newsError, getNewsForSymbol } = useNews(
    colorFilterMode ? colorFilteredSymbols : sortedSymbols,
    selectedSymbol,
    selectedWatchlist,
    isNewsOpen
  );

  const [currentNews, setCurrentNews] = useState<import("./types").NewsArticle[] | undefined>(undefined);

  useEffect(() => {
    if (!selectedSymbol) {
      setCurrentNews(undefined);
      return;
    }

    getNewsForSymbol(selectedSymbol).then(news => {
      setCurrentNews(news);
    });
  }, [selectedSymbol, getNewsForSymbol]);

  useEffect(() => {
    async function boot() {
      try {
        // Migrate watchlists from JSON/CSV to SQLite if needed
        await api.migrateWatchlists().catch(() => {}); // Ignore errors, migration is optional
        
        const [lists, sel] = await Promise.all([
          api.listWatchlists(),
          api.getLastSelection(),
        ]);
        setWatchlists(lists);

        if (sel.interval) {
          setInterval(sel.interval as Interval);
        }

        if (sel.last_picked_watchlist) {
          setLastPickedWatchlist(sel.last_picked_watchlist);
        }

        if (sel.watchlist_name && lists.some((w) => w.name === sel.watchlist_name)) {
          setSelectedWatchlist(sel.watchlist_name);
          const syms: WatchlistSymbol[] = await api.loadSymbols(sel.watchlist_name).catch(() => []);
          setSymbols(syms);
          if (sel.symbol && syms.some(s => s.symbol === sel.symbol)) {
            setSelectedSymbol(sel.symbol);
          }
        }
      } catch {
        // App starts with empty state.
      }
    }
    boot();
  }, []);

  // Listen for symbol sync events in child windows
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    async function setupListener() {
      unlisten = await listen<SymbolSyncPayload>(SYMBOL_SYNC_EVENT, (event) => {
        const { symbol, interval: newInterval, watchlistName } = event.payload;
        
        // Update symbol
        if (symbol !== selectedSymbol) {
          setSelectedSymbol(symbol);
        }
        
        // Update interval
        if (newInterval !== interval) {
          setInterval(newInterval);
        }
        
        // Update watchlist if different
        if (watchlistName && watchlistName !== selectedWatchlist) {
          setSelectedWatchlist(watchlistName);
          // Load symbols for the new watchlist
          api.loadSymbols(watchlistName)
            .then(setSymbols)
            .catch(() => setSymbols([]));
        }
      });
    }

    // Only set up listener in child windows or when selectedSymbol is not yet set
    if (mode || !selectedSymbol) {
      setupListener();
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [mode, selectedSymbol, interval, selectedWatchlist]);

  useEffect(() => {
    if (!selectedSymbol) {
      return;
    }

    emit(SYMBOL_SYNC_EVENT, {
      symbol: selectedSymbol,
      interval,
      watchlistName: selectedWatchlist,
    } satisfies SymbolSyncPayload).catch(() => {});
  }, [selectedSymbol, interval, selectedWatchlist]);

  async function handleCloseSettings() {
    setView("chart");
    const lists = await api.listWatchlists().catch(() => watchlists);
    setWatchlists(lists);
  }

  const handleOpenWindow = useCallback(
    async (mode: DetachedWindowMode) => {
      if (mode !== "colorfilter" && !selectedSymbol) {
        return;
      }

      const symbolValue = selectedSymbol;

      const id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${mode}-${Date.now()}`;
      
      let title: string;
      let url: string;
      let width: number;
      let height: number;
      
      if (mode === "colorfilter" || mode === "visited") {
        title = mode === "colorfilter" ? "Color Filter" : "Visited Symbols";
        url = `/?mode=${mode}`;
        width = 320;
        height = 600;
      } else {
        title = mode === "sr" ? "SR Chart" : mode === "fib" ? "Fib Chart" : "EMA Chart";
        url = `/?mode=${mode}&symbol=${encodeURIComponent(symbolValue!)}&interval=${interval}`;
        width = 1180;
        height = 780;
      }

      try {
        const child = new WebviewWindow(`eqw-${mode}-${id}`, {
          title,
          url,
          width,
          height,
        });

        await new Promise<void>((resolve, reject) => {
          let settled = false;
          let timeoutId = 0;

          const finish = (cb: () => void) => {
            if (settled) {
              return;
            }
            settled = true;
            if (timeoutId) {
              window.clearTimeout(timeoutId);
            }
            cb();
          };

          void child.once("tauri://created", () => finish(resolve));
          void child.once("tauri://error", (event) => {
            const message =
              typeof event.payload === "string" && event.payload.trim().length > 0
                ? event.payload
                : `Failed to create ${mode} window`;
            finish(() => reject(new Error(message)));
          });

          timeoutId = window.setTimeout(() => finish(resolve), 1500);
        });

        if (mode === "visited") {
          emit(VISITED_SYMBOLS_EVENT, visitedSymbols).catch(() => {});
        } else if (mode !== "colorfilter" && symbolValue) {
          emit(SYMBOL_SYNC_EVENT, {
            symbol: symbolValue,
            interval,
            watchlistName: selectedWatchlist,
          } satisfies SymbolSyncPayload).catch(() => {});
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setChartError(`Window open failed: ${message}`);
      }
    },
    [selectedSymbol, interval, selectedWatchlist, visitedSymbols]
  );

  useEffect(() => {
    if (!selectedSymbol) {
      return;
    }
    const symbolValue = selectedSymbol;
    let cancelled = false;

    async function load() {
      setIsLoadingChart(true);
      setChartError(null);
      setChartWarning(null);
      try {
        const resp = await api.getChartData(symbolValue, interval);
        if (cancelled) {
          return;
        }
        setCandles(resp.candles);
        setFreshness(resp.freshness);
        setLastSync(resp.last_sync ?? null);
        setChartWarning(resp.warning ?? null);
      } catch (e) {
        if (cancelled) {
          return;
        }
        setCandles([]);
        setChartError(String(e));
      } finally {
        if (!cancelled) {
          setIsLoadingChart(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol, interval]);

  const handleSelectWatchlist = useCallback(
    async (name: string) => {
      setSelectedWatchlist(name);
      setSymbols([]);
      setIsLoadingSymbols(true);
      setColorFilterMode(false);
      try {
        const syms = await api.loadSymbols(name);
        setSymbols(syms);
      } catch {
        setSymbols([]);
      } finally {
        setIsLoadingSymbols(false);
      }
      api.setLastSelection(name, selectedSymbol, interval).catch(() => {});
    },
    [selectedSymbol, interval]
  );

  useEffect(() => {
    if (!colorFilterMode) {
      setColorFilteredSymbols([]);
      return;
    }

    if (colorFilterType === 'color' && !colorFilterValue.color && !colorFilterValue.tagColor) {
      setColorFilteredSymbols([]);
      return;
    }

    let cancelled = false;
    async function loadFilteredSymbols() {
      setIsLoadingColorFilter(true);
      try {
        let syms: ColorFilteredSymbol[];
        if (colorFilterType === 'alerts') {
          syms = await api.getSymbolsWithAlerts();
        } else if (colorFilterType === 'positions') {
          syms = await api.getSymbolsWithPositions();
        } else {
          syms = await api.getSymbolsByColor(colorFilterValue.color, colorFilterValue.tagColor);
        }
        if (!cancelled) {
          setColorFilteredSymbols(syms);
        }
      } catch (error) {
        console.error('Failed to load filtered symbols:', error);
        if (!cancelled) {
          setColorFilteredSymbols([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingColorFilter(false);
        }
      }
    }
    loadFilteredSymbols();
    return () => { cancelled = true; };
  }, [colorFilterMode, colorFilterValue, colorFilterType]);

  const handleColorFilterChange = useCallback((color: string | null, tagColor: string | null) => {
    setColorFilterValue({ color, tagColor });
  }, []);

  const handleColorFilterTypeChange = useCallback((type: 'color' | 'alerts' | 'positions') => {
    setColorFilterType(type);
  }, []);

  const handleSelectSymbol = useCallback(
    (sym: string) => {
      setSelectedSymbol(sym);
      api.setLastSelection(selectedWatchlist, sym, interval).catch(() => {});
      
      setVisitedSymbols(prev => {
        if (prev.some(s => s.symbol === sym)) {
          return prev;
        }
        const updated = [...prev, { symbol: sym, timestamp: Date.now() }];
        emit(VISITED_SYMBOLS_EVENT, updated).catch(() => {});
        return updated;
      });
    },
    [selectedWatchlist, interval]
  );

  const handleIntervalChange = useCallback(
    (iv: Interval) => {
      setInterval(iv);
      api.setLastSelection(selectedWatchlist, selectedSymbol, iv).catch(() => {});
    },
    [selectedWatchlist, selectedSymbol]
  );

  const handleRefreshChartData = useCallback(async () => {
    if (!selectedSymbol) {
      return;
    }

    setIsLoadingChart(true);
    setChartError(null);
    setChartWarning(null);

    try {
      const resp = await api.refreshChartData(selectedSymbol, interval);
      setCandles(resp.candles);
      setFreshness(resp.freshness);
      setLastSync(resp.last_sync ?? null);
      setChartWarning(resp.warning ?? null);
    } catch (e) {
      setCandles([]);
      setChartError(String(e));
    } finally {
      setIsLoadingChart(false);
    }
  }, [selectedSymbol, interval]);

  const handleUpdateSymbolColor = useCallback(
    async (symbol: string, color: string | null) => {
      if (!selectedWatchlist) return;
      
      try {
        await api.updateSymbolColor(selectedWatchlist, symbol, color);
        // Reload symbols to get updated colors
        const updatedSymbols = await api.loadSymbols(selectedWatchlist);
        setSymbols(updatedSymbols);
      } catch (error) {
        console.error('Failed to update symbol color:', error);
      }
    },
    [selectedWatchlist]
  );

  const handleUpdateSymbolTagColor = useCallback(
    async (symbol: string, tagColor: string | null) => {
      if (!selectedWatchlist) return;
      
      try {
        await api.updateSymbolTagColor(selectedWatchlist, symbol, tagColor);
        const updatedSymbols = await api.loadSymbols(selectedWatchlist);
        setSymbols(updatedSymbols);
      } catch (error) {
        console.error('Failed to update symbol tag color:', error);
      }
    },
    [selectedWatchlist]
  );

  const handleRemoveSymbol = useCallback(
    async (symbol: string) => {
      if (!selectedWatchlist) return;

      try {
        await api.removeSymbol(selectedWatchlist, symbol);
        const updatedSymbols = await api.loadSymbols(selectedWatchlist);
        setSymbols(updatedSymbols);
        if (selectedSymbol === symbol) {
          setSelectedSymbol(null);
        }
      } catch (error) {
        console.error('Failed to remove symbol:', error);
      }
    },
    [selectedWatchlist, selectedSymbol]
  );

  const handleSelectFromSearch = useCallback(
    (watchlistName: string, symbolName: string) => {
      setSelectedWatchlist(watchlistName);
      setSelectedSymbol(symbolName);
      api.setLastSelection(watchlistName, symbolName, interval).catch(() => {});
      // Load symbols for the selected watchlist
      api.loadSymbols(watchlistName)
        .then(setSymbols)
        .catch(() => setSymbols([]));
    },
    [interval]
  );

  // Keyboard navigation: spacebar to next symbol (skips visited symbols)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      
      const currentSymbols = colorFilterMode 
        ? colorFilteredSymbols.map(s => ({ symbol: s.symbol, color: s.color, tag_color: s.tag_color }))
        : sortedSymbols;
      
      if (event.code === 'Space' && currentSymbols.length > 0 && selectedSymbol) {
        event.preventDefault();
        
        const visitedSet = new Set(visitedSymbols.map(s => s.symbol));
        const currentIndex = currentSymbols.findIndex(s => s.symbol === selectedSymbol);
        
        if (currentIndex !== -1) {
          let nextIndex = (currentIndex + 1) % currentSymbols.length;
          let attempts = 0;
          
          while (attempts < currentSymbols.length) {
            const candidateSymbol = currentSymbols[nextIndex].symbol;
            
            if (!visitedSet.has(candidateSymbol) || candidateSymbol === selectedSymbol) {
              handleSelectSymbol(candidateSymbol);
              break;
            }
            
            nextIndex = (nextIndex + 1) % currentSymbols.length;
            attempts++;
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sortedSymbols, colorFilteredSymbols, colorFilterMode, selectedSymbol, handleSelectSymbol, visitedSymbols]);

  // Keyboard shortcut: Cmd+M to open watchlist picker
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'm') {
        event.preventDefault();
        if (selectedSymbol && watchlists.length > 0) {
          setIsPickerOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedSymbol, watchlists.length]);

  const handleMoveToWatchlist = useCallback(
    async (watchlistName: string) => {
      if (!selectedSymbol || !selectedWatchlist) return;

      try {
        const currentIndex = sortedSymbols.findIndex(s => s.symbol === selectedSymbol);

        await api.addSymbolToWatchlist(watchlistName, selectedSymbol);
        if (selectedWatchlist !== watchlistName) {
          await api.removeSymbol(selectedWatchlist, selectedSymbol);
        }
        setLastPickedWatchlist(watchlistName);
        const updatedSyms = await api.loadSymbols(selectedWatchlist);
        setSymbols(updatedSyms);

        if (currentIndex !== -1 && updatedSyms.length > 0) {
          const nextIndex = (currentIndex) % updatedSyms.length;
          handleSelectSymbol(updatedSyms[nextIndex].symbol);
        }

        await api.setLastSelection(
          selectedWatchlist,
          selectedSymbol,
          interval,
          watchlistName
        );
      } catch (error) {
        console.error('Failed to move symbol to watchlist:', error);
      }
      setIsPickerOpen(false);
    },
    [selectedSymbol, selectedWatchlist, interval, sortedSymbols, handleSelectSymbol]
  );

  // Render appropriate chart panel based on mode
  const renderChartPanel = () => {
    const props = {
      symbol: selectedSymbol,
      interval,
      candles,
      isLoading: isLoadingChart,
      freshness,
      lastSync,
      warning: chartWarning,
    };

    switch (mode) {
      case "sr":
        return <SRChartPanel {...props} />;
      case "ema":
        return <EMAChartPanel {...props} />;
      case "fib":
        return <FibChartPanel {...props} />;
      case "colorfilter":
        return <ColorFilterPanel />;
      case "visited":
        return <VisitedSymbolTracker />;
      default:
        return <BaseChartPanel {...props} onFetch={handleRefreshChartData} onSelectWatchlist={handleSelectFromSearch} />;
    }
  };

  return (
    <div className="app-root">
      {view === "settings" ? (
        <SettingsPanel onClose={handleCloseSettings} />
      ) : mode === "colorfilter" ? (
        <ColorFilterPanel />
      ) : mode === "visited" ? (
        <VisitedSymbolTracker />
      ) : (
        <div className="chart-layout">
          <div className="chart-pane">
            {chartError && <div className="chart-error-banner">✗ {chartError}</div>}
            {renderChartPanel()}
          </div>

          <WatchlistPanel
            watchlists={watchlists}
            selectedWatchlist={selectedWatchlist}
            symbols={sortedSymbols}
            selectedSymbol={selectedSymbol}
            interval={interval}
            isLoadingSymbols={isLoadingSymbols}
            onSelectWatchlist={handleSelectWatchlist}
            onSelectSymbol={handleSelectSymbol}
            onIntervalChange={handleIntervalChange}
            onOpenSettings={() => setView("settings")}
            onOpenWindow={handleOpenWindow}
            onOpenNews={() => setIsNewsOpen(true)}
            onUpdateSymbolColor={handleUpdateSymbolColor}
            onUpdateSymbolTagColor={handleUpdateSymbolTagColor}
            onRemoveSymbol={handleRemoveSymbol}
            isDetached={Boolean(mode)}
            sortMode={sortMode}
            onSortModeChange={setSortMode}
            colorFilterMode={colorFilterMode}
            colorFilterValue={colorFilterValue}
            colorFilterType={colorFilterType}
            onColorFilterChange={handleColorFilterChange}
            onColorFilterTypeChange={handleColorFilterTypeChange}
            colorFilteredSymbols={colorFilteredSymbols}
            isLoadingColorFilter={isLoadingColorFilter}
            onEnableColorFilterMode={() => setColorFilterMode(true)}
          />
        </div>
      )}

      <WatchlistPicker
        isOpen={isPickerOpen}
        watchlists={watchlists}
        currentSymbol={selectedSymbol}
        lastPickedWatchlist={lastPickedWatchlist}
        onClose={() => setIsPickerOpen(false)}
        onSelect={handleMoveToWatchlist}
      />

      {isNewsOpen && (
        <NewsPanel
          articles={currentNews}
          isLoading={isLoadingNews}
          error={newsError}
          onClose={() => setIsNewsOpen(false)}
        />
      )}
    </div>
  );
}
