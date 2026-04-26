import { useCallback, useEffect, useState } from "react";
import type { Interval, WatchlistEntry, WatchlistSymbol } from "../types";
import IntervalSelector from "./IntervalSelector";

type DetachedWindowMode = "fib" | "ema" | "sr";

interface Props {
  watchlists: WatchlistEntry[];
  selectedWatchlist: string | null;
  symbols: WatchlistSymbol[];
  selectedSymbol: string | null;
  interval: Interval;
  isLoadingSymbols: boolean;
  onSelectWatchlist: (name: string) => void;
  onSelectSymbol: (symbol: string) => void;
  onIntervalChange: (interval: Interval) => void;
  onOpenSettings: () => void;
  onOpenWindow: (mode: DetachedWindowMode) => void;
  onUpdateSymbolColor: (symbol: string, color: string | null) => void;
  onUpdateSymbolTagColor: (symbol: string, tagColor: string | null) => void;
  isDetached?: boolean;
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
  onUpdateSymbolColor,
  onUpdateSymbolTagColor,
  isDetached = false,
}: Props) {
  const canOpenWindow = Boolean(selectedSymbol);
  const [collapsed, setCollapsed] = useState(false);

  // Color mapping for keyboard shortcuts
  const statusColors: Record<string, string> = {
    'r': 'red',
    'y': 'yellow',
    'g': 'green',
  };

  const tagColors: Record<string, string> = {
    'v': 'violet',
    'o': 'orange',
    'b': 'blue',
    'i': 'indigo',
    'p': 'pink',
  };

  const handleKeyPress = useCallback((event: KeyboardEvent) => {
    if (!selectedSymbol) return;

    const key = event.key.toLowerCase();
    if (statusColors[key]) {
      event.preventDefault();
      onUpdateSymbolColor(selectedSymbol, statusColors[key]);
    } else if (tagColors[key]) {
      event.preventDefault();
      onUpdateSymbolTagColor(selectedSymbol, tagColors[key]);
    }
  }, [selectedSymbol, onUpdateSymbolColor, onUpdateSymbolTagColor]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  return (
    <div className={`watchlist-panel${collapsed ? ' watchlist-panel--collapsed' : ''}`}>
      {/* Top: title + settings gear */}
      <div className="watchlist-header">
        {!collapsed && <span className="watchlist-title">Watchlist</span>}
        <div className="watchlist-actions">
          {isDetached && (
            <button
              className="icon-btn"
              title={collapsed ? "Expand watchlist" : "Collapse watchlist"}
              onClick={() => setCollapsed((c) => !c)}
            >
              {collapsed ? '▸' : '◂'}
            </button>
          )}
          {!collapsed && (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Watchlist content - hidden when collapsed */}
      {!collapsed && (
        <>
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
                key={sym.symbol}
                className={`symbol-item${selectedSymbol === sym.symbol ? " active" : ""}`}
                onClick={() => onSelectSymbol(sym.symbol)}
                title={sym.symbol}
                style={{
                  /*backgroundColor: sym.tag_color || undefined,*/
                  borderRight: sym.color ? `5px solid ${sym.color}` : undefined,
                  borderLeft: sym.tag_color ? `5px solid ${sym.tag_color}` : undefined
                }}
              >
                {displaySymbol(sym.symbol)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
