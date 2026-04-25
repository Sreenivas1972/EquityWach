import type { Interval, WatchlistEntry } from "../types";
import IntervalSelector from "./IntervalSelector";

type DetachedWindowMode = "fib" | "ema" | "sr";

interface Props {
  watchlists: WatchlistEntry[];
  selectedWatchlist: string | null;
  symbols: string[];
  selectedSymbol: string | null;
  interval: Interval;
  isLoadingSymbols: boolean;
  onSelectWatchlist: (name: string) => void;
  onSelectSymbol: (symbol: string) => void;
  onIntervalChange: (interval: Interval) => void;
  onOpenSettings: () => void;
  onOpenWindow: (mode: DetachedWindowMode) => void;
}

/** Strip "EXCHANGE:" prefix for display purposes */
function displaySymbol(s: string): string {
  return s.includes(":") ? s.split(":")[1] : s;
}

export default function WatchlistPanel({
  watchlists,
  selectedWatchlist,
  symbols,
  selectedSymbol,
  interval,
  isLoadingSymbols,
  onSelectWatchlist,
  onSelectSymbol,
  onIntervalChange,
  onOpenSettings,
  onOpenWindow,
}: Props) {
  const canOpenWindow = Boolean(selectedSymbol);

  return (
    <div className="watchlist-panel">
      {/* Top: title + settings gear */}
      <div className="watchlist-header">
        <span className="watchlist-title">Watchlist</span>
        <div className="watchlist-actions">
          <details className="window-menu">
            <summary className="icon-btn" title="Open Windows">
              ▾
            </summary>
            <div className="window-menu-popover" role="menu">
              <button
                type="button"
                onClick={() => onOpenWindow("fib")}
                disabled={!canOpenWindow}
              >
                Fib Window
              </button>
              <button
                type="button"
                onClick={() => onOpenWindow("ema")}
                disabled={!canOpenWindow}
              >
                EMA Window
              </button>
              <button
                type="button"
                onClick={() => onOpenWindow("sr")}
                disabled={!canOpenWindow}
              >
                SR Window
              </button>
            </div>
          </details>
          <button
            className="icon-btn"
            title="Settings"
            onClick={onOpenSettings}
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Watchlist selector */}
      {watchlists.length === 0 ? (
        <div className="watchlist-empty">
          <p>No watchlists configured.</p>
          <button className="btn-primary" onClick={onOpenSettings}>
            Add Watchlist
          </button>
        </div>
      ) : (
        <select
          className="watchlist-select"
          value={selectedWatchlist ?? ""}
          onChange={(e) => onSelectWatchlist(e.target.value)}
        >
          <option value="" disabled>
            — choose watchlist —
          </option>
          {watchlists.map((w) => (
            <option key={w.name} value={w.name}>
              {w.name}
            </option>
          ))}
        </select>
      )}

      {/* Interval selector */}
      <IntervalSelector value={interval} onChange={onIntervalChange} />

      {/* Symbol list */}
      <div className="symbol-list">
        {isLoadingSymbols && (
          <div className="symbol-list-loading">Loading symbols…</div>
        )}
        {!isLoadingSymbols && selectedWatchlist && symbols.length === 0 && (
          <div className="symbol-list-empty">No symbols found in file.</div>
        )}
        {symbols.map((sym) => (
          <button
            key={sym}
            className={`symbol-item${selectedSymbol === sym ? " active" : ""}`}
            onClick={() => onSelectSymbol(sym)}
            title={sym}
          >
            {displaySymbol(sym)}
          </button>
        ))}
      </div>
    </div>
  );
}
