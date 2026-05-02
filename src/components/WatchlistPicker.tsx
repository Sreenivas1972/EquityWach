import { useEffect, useRef, useState } from "react";
import type { WatchlistEntry } from "../types";
import "./WatchlistPicker.css";

interface WatchlistPickerProps {
  isOpen: boolean;
  watchlists: WatchlistEntry[];
  currentSymbol: string | null;
  lastPickedWatchlist: string | null;
  onClose: () => void;
  onSelect: (watchlistName: string) => void;
}

export default function WatchlistPicker({
  isOpen,
  watchlists,
  currentSymbol,
  lastPickedWatchlist,
  onClose,
  onSelect,
}: WatchlistPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const targetIndex = lastPickedWatchlist
      ? watchlists.findIndex((w) => w.name === lastPickedWatchlist)
      : 0;
    setSelectedIndex(targetIndex >= 0 ? targetIndex : 0);
  }, [isOpen, watchlists, lastPickedWatchlist]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          break;
        case "ArrowDown":
          event.preventDefault();
          setSelectedIndex((prev) => Math.min(watchlists.length - 1, prev + 1));
          break;
        case "Enter":
          event.preventDefault();
          if (watchlists[selectedIndex]) {
            onSelect(watchlists[selectedIndex].name);
          }
          break;
        case "Escape":
          event.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, watchlists, selectedIndex, onSelect, onClose]);

  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="watchlist-picker-overlay" onClick={onClose}>
      <div
        className="watchlist-picker-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="watchlist-picker-header">
          Move to watchlist
          {currentSymbol && (
            <span className="watchlist-picker-symbol"> {currentSymbol}</span>
          )}
        </div>
        <div className="watchlist-picker-list" ref={listRef}>
          {watchlists.map((watchlist, index) => (
            <div
              key={watchlist.name}
              className={`watchlist-picker-item ${
                index === selectedIndex ? "selected" : ""
              }`}
              onClick={() => onSelect(watchlist.name)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              {watchlist.name}
              {watchlist.name === lastPickedWatchlist && (
                <span className="watchlist-picker-hint">last used</span>
              )}
            </div>
          ))}
        </div>
        <div className="watchlist-picker-footer">
          ↑↓ navigate · Enter select · Esc close
        </div>
      </div>
    </div>
  );
}