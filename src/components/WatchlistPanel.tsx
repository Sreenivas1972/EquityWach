import { useCallback, useEffect, useRef, useState } from "react";
import type { Interval, WatchlistEntry, WatchlistSymbol } from "../types";
import type { SortMode } from "../App";
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
  onRemoveSymbol: (symbol: string) => void;
  isDetached?: boolean;
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
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
  onRemoveSymbol,
  isDetached = false,
  sortMode,
  onSortModeChange,
}: Props) {
  const canOpenWindow = Boolean(selectedSymbol);
  const [collapsed, setCollapsed] = useState(false);
  const symbolListRef = useRef<HTMLDivElement>(null);

  // Color mapping for keyboard shortcuts
  const statusColors: Record<string, string> = {
    'r': '#ff4d4d', // red
    'y': '#ffcc00', // dark yellow
    'g': '#3fb950', // light green
  };

  const tagColors: Record<string, string> = {
    'v': 'violet',
    'o': 'orange',
    'b': 'blue',
    'i': 'indigo',
    'p': 'pink',
  };

  const handleKeyPress = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }

    if (!selectedSymbol) return;

    const key = event.key.toLowerCase();
    if (statusColors[key]) {
      event.preventDefault();
      onUpdateSymbolColor(selectedSymbol, statusColors[key]);
    } else if (tagColors[key]) {
      event.preventDefault();
      onUpdateSymbolTagColor(selectedSymbol, tagColors[key]);
    } else if (key === 'c') {
      event.preventDefault();
      onUpdateSymbolColor(selectedSymbol, null);
    } else if (key === 'd') {
      event.preventDefault();
      onUpdateSymbolTagColor(selectedSymbol, null);
    }
  }, [selectedSymbol, onUpdateSymbolColor, onUpdateSymbolTagColor]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  // Scroll selected symbol into view
  useEffect(() => {
    if (selectedSymbol && symbolListRef.current) {
      const selectedElement = symbolListRef.current.querySelector(`.symbol-item.active`) as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    }
  }, [selectedSymbol]);

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

          {/* Sort controls */}
          <div className="sort-controls">
            <button
              type="button"
              className={`sort-btn${sortMode === 'alpha' ? ' sort-btn--active' : ''}`}
              title="Sort alphabetically"
              onClick={() => onSortModeChange('alpha')}
            >
              A–Z
            </button>
            <button
              type="button"
              className={`sort-btn${sortMode === 'color' ? ' sort-btn--active' : ''}`}
              title="Sort by status color (red → yellow → green)"
              onClick={() => onSortModeChange('color')}
            >
              🔴
            </button>
            <button
              type="button"
              className={`sort-btn${sortMode === 'tag_color' ? ' sort-btn--active' : ''}`}
              title="Sort by tag color (violet → indigo → blue → orange → pink)"
              onClick={() => onSortModeChange('tag_color')}
            >
              🏷
            </button>
          </div>

          {/* Symbol list */}
          <div className="symbol-list" ref={symbolListRef}>
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
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    onRemoveSymbol(sym.symbol);
                  } else {
                    onSelectSymbol(sym.symbol);
                  }
                }}
                title={sym.symbol}
                style={{
                  backgroundColor: sym.color || undefined,
                  /*borderRight: sym.color ? `10px solid ${sym.color}` : undefined, */
                  borderLeft: sym.tag_color ? `10px solid ${sym.tag_color}` : undefined
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
