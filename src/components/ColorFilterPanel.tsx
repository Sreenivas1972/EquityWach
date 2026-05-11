import { useCallback, useEffect, useMemo, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { api } from "../services/tauriApi";
import type { ColorFilteredSymbol } from "../types";
import { SYMBOL_SYNC_EVENT, type SymbolSyncPayload } from "../windows/shared";

type ColorFilterType = 'color' | 'alerts' | 'positions';

function displaySymbol(s: string): string {
  return s.includes(":") ? s.split(":")[1] : s;
}

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

export default function ColorFilterPanel() {
  const [colorFilterType, setColorFilterType] = useState<ColorFilterType>('alerts');
  const [colorFilterValue, setColorFilterValue] = useState<{ color: string | null; tagColor: string | null }>({ color: null, tagColor: null });
  const [colorFilteredSymbols, setColorFilteredSymbols] = useState<ColorFilteredSymbol[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const displaySymbols = useMemo(() => {
    if (colorFilterType === 'color') {
      return colorFilteredSymbols;
    }
    const seen = new Set<string>();
    return colorFilteredSymbols.filter(sym => {
      if (seen.has(sym.symbol)) {
        return false;
      }
      seen.add(sym.symbol);
      return true;
    });
  }, [colorFilteredSymbols, colorFilterType]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    async function setupListener() {
      unlisten = await listen<SymbolSyncPayload>(SYMBOL_SYNC_EVENT, (event) => {
        const { symbol } = event.payload;
        if (symbol !== selectedSymbol) {
          setSelectedSymbol(symbol);
        }
      });
    }

    setupListener();
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [selectedSymbol]);

  useEffect(() => {
    if (colorFilterType === 'color' && !colorFilterValue.color && !colorFilterValue.tagColor) {
      setColorFilteredSymbols([]);
      return;
    }

    let cancelled = false;
    async function loadFilteredSymbols() {
      setIsLoading(true);
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
          setIsLoading(false);
        }
      }
    }
    loadFilteredSymbols();
    return () => { cancelled = true; };
  }, [colorFilterType, colorFilterValue]);

  const handleColorFilterChange = useCallback((color: string | null, tagColor: string | null) => {
    setColorFilterValue({ color, tagColor });
  }, []);

  const handleColorFilterTypeChange = useCallback((type: ColorFilterType) => {
    setColorFilterType(type);
  }, []);

  const handleSelectSymbol = useCallback(async (symbol: string) => {
    setSelectedSymbol(symbol);
    await emit(SYMBOL_SYNC_EVENT, {
      symbol,
      interval: 'day' as const,
      watchlistName: null,
    } satisfies SymbolSyncPayload);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      
      if (event.code === 'Space' && displaySymbols.length > 0 && selectedSymbol) {
        event.preventDefault();
        
        const currentIndex = displaySymbols.findIndex(s => s.symbol === selectedSymbol);
        if (currentIndex !== -1) {
          const nextIndex = (currentIndex + 1) % displaySymbols.length;
          const nextSymbol = displaySymbols[nextIndex].symbol;
          handleSelectSymbol(nextSymbol);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [displaySymbols, selectedSymbol, handleSelectSymbol]);

  return (
    <div className="color-filter-panel">
      <div className="color-filter-controls">
        <div className="color-filter-type-buttons">
          <button
            type="button"
            className={`color-filter-type-btn${colorFilterType === 'color' ? ' color-filter-type-btn--active' : ''}`}
            onClick={() => handleColorFilterTypeChange('color')}
            title="Filter by color"
          >
            🎨
          </button>
          <button
            type="button"
            className={`color-filter-type-btn${colorFilterType === 'alerts' ? ' color-filter-type-btn--active' : ''}`}
            onClick={() => handleColorFilterTypeChange('alerts')}
            title="Symbols with price alerts"
          >
            🔔
          </button>
          <button
            type="button"
            className={`color-filter-type-btn${colorFilterType === 'positions' ? ' color-filter-type-btn--active' : ''}`}
            onClick={() => handleColorFilterTypeChange('positions')}
            title="Symbols with long positions"
          >
            📈
          </button>
        </div>
        {colorFilterType === 'color' && (
          <div className="color-filter-selects">
            <select
              className="color-filter-select"
              value={colorFilterValue.color ?? ""}
              onChange={(e) => handleColorFilterChange(e.target.value || null, colorFilterValue.tagColor)}
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
              onChange={(e) => handleColorFilterChange(colorFilterValue.color, e.target.value || null)}
            >
              <option value="">Tag:All</option>
              {tagColorOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="color-filter-symbol-list">
        {isLoading && (
          <div className="symbol-list-loading">Loading symbols…</div>
        )}
        {!isLoading && displaySymbols.length === 0 && (colorFilterType !== 'color' || colorFilterValue.color || colorFilterValue.tagColor) && (
          <div className="symbol-list-empty">
            {colorFilterType === 'alerts' && 'No symbols with price alerts.'}
            {colorFilterType === 'positions' && 'No symbols with long positions.'}
            {colorFilterType === 'color' && 'No symbols match the filter.'}
          </div>
        )}
        {displaySymbols.map((sym) => (
          <button
            key={colorFilterType === 'color' ? `${sym.symbol}-${sym.watchlist_name}` : sym.symbol}
            className={`symbol-item${selectedSymbol === sym.symbol ? " active" : ""}`}
            onClick={() => handleSelectSymbol(sym.symbol)}
            title={sym.symbol}
            style={{
              borderRight: sym.color ? `10px solid ${getDisplayColor(sym.color)}` : undefined,
              borderLeft: sym.tag_color ? `10px solid ${getDisplayTagColor(sym.tag_color)}` : undefined
            }}
          >
            <span className="symbol-name">{displaySymbol(sym.symbol)}</span>
            {colorFilterType === 'color' && (
              <span className="symbol-watchlist-badge">{sym.watchlist_name}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
