import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/tauriApi';
import type { NewsArticle, NewsResponse } from '../types';

export function useNews(
  symbols: Array<{ symbol: string }>,
  selectedSymbol: string | null,
  selectedWatchlist: string | null,
  isPanelOpen: boolean
) {
  const [newsData, setNewsData] = useState<Record<string, NewsArticle[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const fetchedKeysRef = useRef<Set<string>>(new Set());
  const fetchingKeysRef = useRef<Set<string>>(new Set());
  const instrumentKeysCacheRef = useRef<Map<string, string>>(new Map());

  const parseSymbol = useCallback((symbol: string): [string, string] => {
    const parts = symbol.split(':');
    const tradingSymbol = parts.length > 1 ? parts[1] : parts[0];
    const exchange = parts.length > 1 ? parts[0] : 'NSE';
    return [tradingSymbol, exchange];
  }, []);

  const getInstrumentKeys = useCallback(async (symbolList: string[]): Promise<Map<string, string>> => {
    const result = new Map<string, string>();
    const toLookup: Array<[string, string]> = [];
    
    for (const symbol of symbolList) {
      const cached = instrumentKeysCacheRef.current.get(symbol);
      if (cached) {
        result.set(symbol, cached);
        continue;
      }
      const [tradingSymbol, exchange] = parseSymbol(symbol);
      toLookup.push([tradingSymbol, exchange]);
    }

    if (toLookup.length > 0) {
      try {
        const lookupResults = await api.lookupInstrumentKeys(toLookup);
        for (const [tradingSymbol, instrumentKey] of lookupResults) {
          if (instrumentKey) {
            const fullSymbol = symbolList.find(s => {
              const [ts] = parseSymbol(s);
              return ts === tradingSymbol;
            });
            if (fullSymbol) {
              result.set(fullSymbol, instrumentKey);
              instrumentKeysCacheRef.current.set(fullSymbol, instrumentKey);
            }
          }
        }
      } catch (err) {
        console.error('Failed to lookup instrument keys:', err);
      }
    }

    return result;
  }, [parseSymbol]);

  const fetchNews = useCallback(async (symbolList: string[]) => {
    if (symbolList.length === 0) return;

    const symbolsToFetch = symbolList.filter(s => 
      !fetchedKeysRef.current.has(s) && !fetchingKeysRef.current.has(s)
    );

    if (symbolsToFetch.length === 0) return;

    symbolsToFetch.forEach(s => fetchingKeysRef.current.add(s));

    try {
      setIsLoading(true);
      setError(null);
      
      const instrumentKeyMap = await getInstrumentKeys(symbolsToFetch);
      const keysToFetch: string[] = [];
      
      for (const key of instrumentKeyMap.values()) {
        if (key && !fetchedKeysRef.current.has(key)) {
          keysToFetch.push(key);
        }
      }

      if (keysToFetch.length === 0) {
        symbolsToFetch.forEach(s => {
          fetchingKeysRef.current.delete(s);
          fetchedKeysRef.current.add(s);
        });
        return;
      }

      const response: NewsResponse = await api.getNews(keysToFetch);
      
      setNewsData(prev => ({
        ...prev,
        ...response.data
      }));

      symbolsToFetch.forEach(s => {
        fetchingKeysRef.current.delete(s);
        fetchedKeysRef.current.add(s);
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      symbolsToFetch.forEach(s => fetchingKeysRef.current.delete(s));
    } finally {
      setIsLoading(false);
    }
  }, [getInstrumentKeys]);

  const prefetchNextSymbols = useCallback((currentIndex: number) => {
    if (!symbols || symbols.length === 0) return;

    const startIdx = currentIndex + 1;
    const endIdx = Math.min(startIdx + 10, symbols.length);

    const symbolsToPrefetch: string[] = [];
    for (let i = startIdx; i < endIdx; i++) {
      const sym = symbols[i].symbol;
      if (!fetchedKeysRef.current.has(sym) && !fetchingKeysRef.current.has(sym)) {
        symbolsToPrefetch.push(sym);
      }
    }

    if (symbolsToPrefetch.length > 0) {
      fetchNews(symbolsToPrefetch);
    }
  }, [symbols, fetchNews]);

  useEffect(() => {
    if (!selectedSymbol || symbols.length === 0 || !isPanelOpen) {
      return;
    }

    const currentIndex = symbols.findIndex(s => s.symbol === selectedSymbol);
    if (currentIndex === -1) return;
    
    if (!fetchedKeysRef.current.has(selectedSymbol) && !fetchingKeysRef.current.has(selectedSymbol)) {
      fetchNews([selectedSymbol]);
    }

    prefetchNextSymbols(currentIndex);
  }, [selectedSymbol, symbols, fetchNews, prefetchNextSymbols, isPanelOpen]);

  useEffect(() => {
    if (!selectedWatchlist) {
      setNewsData({});
      fetchedKeysRef.current.clear();
      fetchingKeysRef.current.clear();
      instrumentKeysCacheRef.current.clear();
    }
  }, [selectedWatchlist]);

  const getNewsForSymbol = useCallback(async (symbol: string): Promise<NewsArticle[] | undefined> => {
    const instrumentKeyMap = await getInstrumentKeys([symbol]);
    const key = instrumentKeyMap.get(symbol);
    return key ? newsData[key] : undefined;
  }, [newsData, getInstrumentKeys]);

  return {
    newsData,
    isLoading,
    error,
    getNewsForSymbol,
    fetchNews,
  };
}
