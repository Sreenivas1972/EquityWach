import { useCallback, useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./App.css";
import ChartPanel from "./components/ChartPanel";
import SettingsPanel from "./components/SettingsPanel";
import WatchlistPanel from "./components/WatchlistPanel";
import { api } from "./services/tauriApi";
import type { CandleData, Interval, WatchlistEntry } from "./types";
import { SYMBOL_SYNC_EVENT, type SymbolSyncPayload } from "./windows/shared";

type DetachedWindowMode = "fib" | "ema" | "sr";

export default function App() {
  const [view, setView] = useState<"chart" | "settings">("chart");

  const [watchlists, setWatchlists] = useState<WatchlistEntry[]>([]);
  const [selectedWatchlist, setSelectedWatchlist] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);

  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [interval, setInterval] = useState<Interval>("day");
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [isLoadingChart, setIsLoadingChart] = useState(false);
  const [freshness, setFreshness] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [chartWarning, setChartWarning] = useState<string | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);

  useEffect(() => {
    async function boot() {
      try {
        const [lists, sel] = await Promise.all([
          api.listWatchlists(),
          api.getLastSelection(),
        ]);
        setWatchlists(lists);

        if (sel.interval) {
          setInterval(sel.interval as Interval);
        }

        if (sel.watchlist_name && lists.some((w) => w.name === sel.watchlist_name)) {
          setSelectedWatchlist(sel.watchlist_name);
          const syms: string[] = await api.loadSymbols(sel.watchlist_name).catch(() => []);
          setSymbols(syms);
          if (sel.symbol && syms.includes(sel.symbol)) {
            setSelectedSymbol(sel.symbol);
          }
        }
      } catch {
        // App starts with empty state.
      }
    }
    boot();
  }, []);

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
      if (!selectedSymbol) {
        return;
      }

      const symbolValue = selectedSymbol;

      const id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${mode}-${Date.now()}`;
      const title = `${mode.toUpperCase()} - ${symbolValue}`;
      const url = `/?mode=${mode}&symbol=${encodeURIComponent(symbolValue)}&interval=${interval}`;

      try {
        const child = new WebviewWindow(`eqw-${mode}-${id}`, {
          title,
          url,
          width: 1180,
          height: 780,
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

        emit(SYMBOL_SYNC_EVENT, {
          symbol: symbolValue,
          interval,
          watchlistName: selectedWatchlist,
        } satisfies SymbolSyncPayload).catch(() => {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setChartError(`Window open failed: ${message}`);
      }
    },
    [selectedSymbol, interval, selectedWatchlist]
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

  const handleSelectSymbol = useCallback(
    (sym: string) => {
      setSelectedSymbol(sym);
      api.setLastSelection(selectedWatchlist, sym, interval).catch(() => {});
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

  return (
    <div className="app-root">
      {view === "settings" ? (
        <SettingsPanel onClose={handleCloseSettings} />
      ) : (
        <div className="chart-layout">
          <div className="chart-pane">
            {chartError && <div className="chart-error-banner">✗ {chartError}</div>}
            <ChartPanel
              symbol={selectedSymbol}
              interval={interval}
              candles={candles}
              isLoading={isLoadingChart}
              freshness={freshness}
              lastSync={lastSync}
              warning={chartWarning}
            />
          </div>

          <WatchlistPanel
            watchlists={watchlists}
            selectedWatchlist={selectedWatchlist}
            symbols={symbols}
            selectedSymbol={selectedSymbol}
            interval={interval}
            isLoadingSymbols={isLoadingSymbols}
            onSelectWatchlist={handleSelectWatchlist}
            onSelectSymbol={handleSelectSymbol}
            onIntervalChange={handleIntervalChange}
            onOpenSettings={() => setView("settings")}
            onOpenWindow={handleOpenWindow}
          />
        </div>
      )}
    </div>
  );
}
