import { useCallback, useEffect, useRef, useState } from "react";
import type { ColorFilteredSymbol, Interval, WatchlistEntry, WatchlistSymbol } from "../types";
import type { SortMode } from "../App";
import IntervalSelector from "./IntervalSelector";

type DetachedWindowMode = "fib" | "ema" | "sr";

type ColorFilterType = 'color' | 'alerts' | 'positions';

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
  colorFilterMode: boolean;
  colorFilterValue: { color: string | null; tagColor: string | null };
  colorFilterType: ColorFilterType;
  onColorFilterChange: (color: string | null, tagColor: string | null) => void;
  onColorFilterTypeChange: (type: ColorFilterType) => void;
  colorFilteredSymbols: ColorFilteredSymbol[];
  isLoadingColorFilter: boolean;
  onEnableColorFilterMode: () => void;
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
  colorFilterMode,
  colorFilterValue,
  colorFilterType,
  onColorFilterChange,
  onColorFilterTypeChange,
  colorFilteredSymbols,
  isLoadingColorFilter,
  onEnableColorFilterMode,
}: Props) {
  const canOpenWindow = Boolean(selectedSymbol);
  const [collapsed, setCollapsed] = useState(false);
  const symbolListRef = useRef<HTMLDivElement>(null);

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

  const statusColorDisplay: Record<string, string> = {
    'red': '#ff4d4d',
    'yellow': '#ffcc00',
    'green': '#3fb950',
  };

  const tagColorDisplay: Record<string, string> = {
    'violet': '#8b5cf6',
    'indigo': '#6366f1',
    'blue': '#3b82f6',
    'orange': '#f97316',
    'pink': '#ec4899',
  };

  const statusColorOptions = [
    { value: 'red', label: 'Red' },
    { value: 'yellow', label: 'Yellow' },
    { value: 'green', label: 'Green' },
  ];

  const tagColorOptions = [
    { value: 'violet', label: 'Violet' },
    { value: 'indigo', label: 'Indigo' },
    { value: 'blue', label: 'Blue' },
    { value: 'orange', label: 'Orange' },
    { value: 'pink', label: 'Pink' },
  ];

  function getDisplayColor(color: string | null): string | undefined {
    if (!color) return undefined;
    return statusColorDisplay[color] || color;
  }

  function getDisplayTagColor(tagColor: string | null): string | undefined {
    if (!tagColor) return undefined;
    return tagColorDisplay[tagColor] || tagColor;
  }

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

    if (event.metaKey || event.ctrlKey) {
      return;
    }

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
            <>
              <select
                className="watchlist-select"
                value={colorFilterMode ? "__color_filter__" : (selectedWatchlist ?? "")}
                onChange={(e) => {
                  if (e.target.value === "__color_filter__") {
                    onEnableColorFilterMode();
                    return;
                  }
                  onSelectWatchlist(e.target.value);
                }}
              >
                <option value="" disabled>
                  — choose watchlist —
                </option>
                <option value="__color_filter__">🎨 Color Filter</option>
                {watchlists.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name}
                  </option>
                ))}
              </select>

              {colorFilterMode && (
                <div className="color-filter-controls">
                  <div className="color-filter-type-buttons">
                    <button
                      type="button"
                      className={`color-filter-type-btn${colorFilterType === 'color' ? ' color-filter-type-btn--active' : ''}`}
                      onClick={() => onColorFilterTypeChange('color')}
                    >
                      🎨 
                    </button>
                    <button
                      type="button"
                      className={`color-filter-type-btn${colorFilterType === 'alerts' ? ' color-filter-type-btn--active' : ''}`}
                      onClick={() => onColorFilterTypeChange('alerts')}
                    >
                      🔔
                    </button>
                    <button
                      type="button"
                      className={`color-filter-type-btn${colorFilterType === 'positions' ? ' color-filter-type-btn--active' : ''}`}
                      onClick={() => onColorFilterTypeChange('positions')}
                    >
                      📈
                    </button>
                  </div>
                  {colorFilterType === 'color' && (
                    <>
                      <select
                        className="color-filter-select"
                        value={colorFilterValue.color ?? ""}
                        onChange={(e) => onColorFilterChange(e.target.value || null, colorFilterValue.tagColor)}
                      >
                        <option value="">Clr:All</option>
                        {statusColorOptions.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className="color-filter-select"
                        value={colorFilterValue.tagColor ?? ""}
                        onChange={(e) => onColorFilterChange(colorFilterValue.color, e.target.value || null)}
                      >
                        <option value="">Tag:All</option>
                        {tagColorOptions.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              )}
            </>
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
            {isLoadingColorFilter && colorFilterMode && (
              <div className="symbol-list-loading">Loading symbols…</div>
            )}
            {isLoadingSymbols && !colorFilterMode && (
              <div className="symbol-list-loading">Loading symbols…</div>
            )}
            {!isLoadingSymbols && !colorFilterMode && selectedWatchlist && symbols.length === 0 && (
              <div className="symbol-list-empty">No symbols found in file.</div>
            )}
            {!isLoadingColorFilter && colorFilterMode && colorFilteredSymbols.length === 0 && (colorFilterType !== 'color' || colorFilterValue.color || colorFilterValue.tagColor) && (
              <div className="symbol-list-empty">
                {colorFilterType === 'alerts' && 'No symbols with price alerts.'}
                {colorFilterType === 'positions' && 'No symbols with long positions.'}
                {colorFilterType === 'color' && 'No symbols match the filter.'}
              </div>
            )}
            {colorFilterMode ? (
              colorFilteredSymbols.map((sym) => (
                <button
                  key={`${sym.symbol}-${sym.watchlist_name}`}
                  className={`symbol-item${selectedSymbol === sym.symbol ? " active" : ""}`}
                  onClick={() => onSelectSymbol(sym.symbol)}
                  title={`${sym.symbol} (${sym.watchlist_name})`}
                  style={{
                    borderRight: sym.color ? `10px solid ${getDisplayColor(sym.color)}` : undefined,
                    borderLeft: sym.tag_color ? `10px solid ${getDisplayTagColor(sym.tag_color)}` : undefined
                  }}
                >
                  <span className="symbol-name">{displaySymbol(sym.symbol)}</span>
                  <span className="symbol-watchlist-badge">{sym.watchlist_name}</span>
                </button>
              ))
            ) : (
              symbols.map((sym) => (
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
                    borderRight: sym.color ? `10px solid ${getDisplayColor(sym.color)}` : undefined,
                    borderLeft: sym.tag_color ? `10px solid ${getDisplayTagColor(sym.tag_color)}` : undefined
                  }}
                >
                  {displaySymbol(sym.symbol)}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
