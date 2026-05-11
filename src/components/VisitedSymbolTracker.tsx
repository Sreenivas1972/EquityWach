import { useCallback, useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { SYMBOL_SYNC_EVENT, VISITED_SYMBOLS_EVENT, type SymbolSyncPayload, type VisitedSymbol } from "../windows/shared";

function displaySymbol(s: string): string {
  return s.includes(":") ? s.split(":")[1] : s;
}

export default function VisitedSymbolTracker() {
  const [visitedSymbols, setVisitedSymbols] = useState<VisitedSymbol[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  useEffect(() => {
    let unlistenSymbol: (() => void) | null = null;
    let unlistenVisited: (() => void) | null = null;

    async function setupListeners() {
      unlistenSymbol = await listen<SymbolSyncPayload>(SYMBOL_SYNC_EVENT, (event) => {
        const { symbol } = event.payload;
        setSelectedSymbol(symbol);
      });

      unlistenVisited = await listen<VisitedSymbol[]>(VISITED_SYMBOLS_EVENT, (event) => {
        setVisitedSymbols(event.payload);
      });
    }

    setupListeners();
    return () => {
      if (unlistenSymbol) unlistenSymbol();
      if (unlistenVisited) unlistenVisited();
    };
  }, []);

  const handleSelectSymbol = useCallback(async (symbol: string) => {
    setSelectedSymbol(symbol);
    await emit(SYMBOL_SYNC_EVENT, {
      symbol,
      interval: 'day' as const,
      watchlistName: null,
    } satisfies SymbolSyncPayload);
  }, []);

  const handleClearAll = useCallback(() => {
    setVisitedSymbols([]);
  }, []);

  const handleRemoveSymbol = useCallback((symbol: string) => {
    setVisitedSymbols(prev => prev.filter(s => s.symbol !== symbol));
  }, []);

  return (
    <div className="visited-tracker-panel">
      <div className="visited-tracker-header">
        <span className="visited-tracker-title">Visited Symbols</span>
        <button
          type="button"
          className="visited-clear-btn"
          onClick={handleClearAll}
          disabled={visitedSymbols.length === 0}
        >
          Clear
        </button>
      </div>

      <div className="visited-symbol-list">
        {visitedSymbols.length === 0 && (
          <div className="symbol-list-empty">No symbols visited yet.</div>
        )}
        {[...visitedSymbols].reverse().map((sym) => (
          <button
            key={sym.symbol}
            className={`symbol-item${selectedSymbol === sym.symbol ? " active" : ""}`}
            onClick={() => handleSelectSymbol(sym.symbol)}
            title={sym.symbol}
          >
            <span className="symbol-name">{displaySymbol(sym.symbol)}</span>
            <button
              type="button"
              className="symbol-remove-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveSymbol(sym.symbol);
              }}
              title="Remove from list"
            >
              ×
            </button>
          </button>
        ))}
      </div>

      <div className="visited-tracker-status">
        <span className="symbol-count">{visitedSymbols.length} visited</span>
      </div>
    </div>
  );
}
