import { useCallback, useEffect, useRef, useState } from "react";
import { UTCTimestamp } from "lightweight-charts";
import { api } from "../services/tauriApi";
import type { ChartNote, CandleData } from "../types";

interface ChartNotesProps {
  symbol: string | null;
  panelType: string;
  chartRef: React.MutableRefObject<any>;
  seriesRef: React.MutableRefObject<any>;
  candles: CandleData[];
}

export default function ChartNotes({
  symbol,
  panelType,
  chartRef,
  seriesRef,
  candles,
}: ChartNotesProps) {
  const [notes, setNotes] = useState<ChartNote[]>([]);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [hashtagSuggestions, setHashtagSuggestions] = useState<string[]>([]);
  const [showHashtagSuggestions, setShowHashtagSuggestions] = useState(false);
  const [hashtagCaretPos, setHashtagCaretPos] = useState(0);
  const [currentHashtagStart, setCurrentHashtagStart] = useState<number | null>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const noteModalRef = useRef<HTMLDivElement>(null);
  const crosshairPriceRef = useRef<number | null>(null);
  const crosshairTimeRef = useRef<number | null>(null);
  const pendingNoteAnchorRef = useRef<{ anchorTime: number; anchorPrice: number } | null>(null);

  useEffect(() => {
    if (!symbol) {
      setNotes([]);
      return;
    }
    api.getChartNotes(symbol, panelType).then(setNotes).catch(() => {});
  }, [symbol, panelType]);

  useEffect(() => {
    api.getAllHashtags().then(setHashtags).catch(() => {});
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handleCrosshairMove = (param: any) => {
      if (!param.point || !seriesRef.current) return;
      const price = seriesRef.current.coordinateToPrice(param.point.y);
      if (price !== null && price !== undefined && !Number.isNaN(price)) {
        crosshairPriceRef.current = price as number;
      }
      if (param.time) {
        crosshairTimeRef.current = param.time as number;
      }
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
    };
  }, [chartRef, seriesRef]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        if (!symbol || candles.length === 0) return;
        
        const crosshairPrice = crosshairPriceRef.current;
        const crosshairTime = crosshairTimeRef.current;
        
        const anchorPrice = crosshairPrice !== null && crosshairPrice !== undefined 
          ? crosshairPrice 
          : candles[candles.length - 1].close;
        
        const anchorTime = crosshairTime !== null && crosshairTimeRef.current !== undefined
          ? crosshairTime
          : candles[candles.length - 1].time;
        
        pendingNoteAnchorRef.current = { anchorTime, anchorPrice };
        
        setEditingNoteId(null);
        setNoteText("");
        setShowNoteModal(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [symbol, candles]);

  const handleSaveNote = useCallback(async () => {
    if (!symbol || candles.length === 0 || !noteText.trim()) return;
    
    try {
      if (editingNoteId) {
        await api.updateChartNote(editingNoteId, noteText, null, null);
        setNotes(prev => prev.map(n => 
          n.id === editingNoteId ? { ...n, note_text: noteText } : n
        ));
      } else {
        const pending = pendingNoteAnchorRef.current;
        const anchorPrice = pending?.anchorPrice ?? candles[candles.length - 1].close;
        const anchorTime = pending?.anchorTime ?? candles[candles.length - 1].time;
        
        const id = await api.addChartNote(symbol, panelType, noteText, anchorTime, anchorPrice);
        const newNote: ChartNote = {
          id,
          symbol,
          panel_type: panelType,
          note_text: noteText,
          anchor_time: anchorTime,
          anchor_price: anchorPrice,
          pos_x: null,
          pos_y: null,
          created_at: new Date().toISOString(),
        };
        setNotes(prev => [...prev, newNote]);
      }
      setShowNoteModal(false);
      setNoteText("");
      setEditingNoteId(null);
      pendingNoteAnchorRef.current = null;
      
      const updatedHashtags = await api.getAllHashtags();
      setHashtags(updatedHashtags);
    } catch (e) {
      console.error('Failed to save note:', e);
    }
  }, [symbol, candles, noteText, editingNoteId, panelType]);

  const handleDeleteNote = useCallback(async (id: string) => {
    try {
      await api.deleteChartNote(id);
      setNotes(prev => prev.filter(n => n.id !== id));
    } catch (e) {
      console.error('Failed to delete note:', e);
    }
  }, []);

  const handleNotePositionUpdate = useCallback(async (id: string, posX: number, posY: number) => {
    try {
      await api.updateChartNotePosition(id, posX, posY);
      setNotes(prev => prev.map(n => 
        n.id === id ? { ...n, pos_x: posX, pos_y: posY } : n
      ));
    } catch (e) {
      console.error('Failed to update note position:', e);
    }
  }, []);

  const handleEditNote = useCallback((note: ChartNote) => {
    setEditingNoteId(note.id);
    setNoteText(note.note_text);
    setShowNoteModal(true);
  }, []);

  const handleNoteTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    const caretPos = e.target.selectionStart || 0;
    setNoteText(text);
    
    const textBeforeCaret = text.substring(0, caretPos);
    const lastHashIndex = textBeforeCaret.lastIndexOf('#');
    
    if (lastHashIndex !== -1) {
      const textAfterHash = textBeforeCaret.substring(lastHashIndex + 1);
      if (!textAfterHash.includes(' ') && !textAfterHash.includes('\n')) {
        const partialTag = textAfterHash.toLowerCase();
        const suggestions = hashtags.filter(h => 
          h.toLowerCase().startsWith(partialTag) && h.toLowerCase() !== partialTag
        );
        setHashtagSuggestions(suggestions);
        setShowHashtagSuggestions(suggestions.length > 0);
        setCurrentHashtagStart(lastHashIndex);
        setHashtagCaretPos(caretPos);
        return;
      }
    }
    
    setShowHashtagSuggestions(false);
    setCurrentHashtagStart(null);
  }, [hashtags]);

  const handleSelectHashtag = useCallback((tag: string) => {
    if (currentHashtagStart === null) return;
    
    const beforeHash = noteText.substring(0, currentHashtagStart);
    const afterCaret = noteText.substring(hashtagCaretPos);
    const newText = beforeHash + '#' + tag + ' ' + afterCaret;
    setNoteText(newText);
    setShowHashtagSuggestions(false);
    setCurrentHashtagStart(null);
    
    setTimeout(() => {
      const newCaretPos = beforeHash.length + tag.length + 2;
      noteInputRef.current?.setSelectionRange(newCaretPos, newCaretPos);
      noteInputRef.current?.focus();
    }, 0);
  }, [noteText, currentHashtagStart, hashtagCaretPos]);

  if (notes.length === 0 && !showNoteModal) {
    return null;
  }

  return (
    <>
      {notes.length > 0 && (
        <div className="notes-overlay" style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          pointerEvents: "none",
          zIndex: 12,
        }}>
          {notes.map((note) => {
            const chart = chartRef.current;
            if (!chart) return null;
            
            const timeScale = chart.timeScale();
            const coordinate = timeScale.timeToCoordinate(note.anchor_time as UTCTimestamp);
            const priceY = seriesRef.current?.priceToCoordinate(note.anchor_price);
            
            if (coordinate === null || priceY === null || priceY === undefined) return null;
            
            const noteX = note.pos_x !== null ? note.pos_x : coordinate + 20;
            const noteY = note.pos_y !== null ? note.pos_y : priceY - 20;
            
            return (
              <div
                key={note.id}
                style={{
                  position: "absolute",
                  left: noteX,
                  top: noteY,
                  pointerEvents: "auto",
                  cursor: "move",
                  maxWidth: 250,
                }}
                onMouseDown={(e) => {
                  if (e.target instanceof HTMLButtonElement) return;
                  e.preventDefault();
                  e.stopPropagation();
                  
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const startNoteX = noteX;
                  const startNoteY = noteY;
                  
                  const handleMouseMove = (moveEvent: MouseEvent) => {
                    const deltaX = moveEvent.clientX - startX;
                    const deltaY = moveEvent.clientY - startY;
                    const newX = startNoteX + deltaX;
                    const newY = startNoteY + deltaY;
                    
                    setNotes(prev => prev.map(n => 
                      n.id === note.id ? { ...n, pos_x: newX, pos_y: newY } : n
                    ));
                  };
                  
                  const handleMouseUp = () => {
                    window.removeEventListener('mousemove', handleMouseMove);
                    window.removeEventListener('mouseup', handleMouseUp);
                    
                    const finalNote = notes.find(n => n.id === note.id);
                    if (finalNote) {
                      const deltaX = finalNote.pos_x !== null ? finalNote.pos_x - noteX : 0;
                      const deltaY = finalNote.pos_y !== null ? finalNote.pos_y - noteY : 0;
                      handleNotePositionUpdate(note.id, startNoteX + deltaX, startNoteY + deltaY);
                    }
                  };
                  
                  window.addEventListener('mousemove', handleMouseMove);
                  window.addEventListener('mouseup', handleMouseUp);
                }}
              >
                <div style={{
                  background: "rgba(59, 130, 246, 0.95)",
                  color: "#fff",
                  border: "2px solid #fff",
                  borderRadius: 6,
                  padding: "8px 10px",
                  fontSize: 12,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                  userSelect: "none",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}>
                  {note.note_text.split(/(#\w+)/g).map((part, i) => 
                    part.startsWith('#') 
                      ? <span key={i} style={{ color: '#fbbf24', fontWeight: 'bold' }}>{part}</span>
                      : part
                  )}
                  <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditNote(note);
                      }}
                      style={{
                        background: "rgba(255,255,255,0.2)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 3,
                        padding: "2px 6px",
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteNote(note.id);
                      }}
                      style={{
                        background: "rgba(239, 68, 68, 0.8)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 3,
                        padding: "2px 6px",
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showNoteModal && (
        <div
          ref={noteModalRef}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "#fff",
            border: "1px solid #d4deea",
            borderRadius: 8,
            padding: 16,
            zIndex: 100,
            boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
            minWidth: 320,
          }}
        >
          <h3 style={{ margin: "0 0 12px 0", fontSize: 14, color: "#1f2937" }}>
            {editingNoteId ? "Edit Note" : "Add Note"}
          </h3>
          <div style={{ position: "relative" }}>
            <textarea
              ref={noteInputRef}
              value={noteText}
              onChange={handleNoteTextChange}
              placeholder="Enter note text... Use # for hashtags"
              style={{
                width: "100%",
                height: 80,
                padding: 8,
                border: "1px solid #d4deea",
                borderRadius: 4,
                fontSize: 13,
                resize: "none",
                outline: "none",
                fontFamily: "inherit",
              }}
              autoFocus
            />
            {showHashtagSuggestions && hashtagSuggestions.length > 0 && (
              <div style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "#fff",
                border: "1px solid #d4deea",
                borderRadius: 4,
                maxHeight: 120,
                overflowY: "auto",
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                zIndex: 10,
              }}>
                {hashtagSuggestions.map((tag) => (
                  <div
                    key={tag}
                    onClick={() => handleSelectHashtag(tag)}
                    style={{
                      padding: "6px 10px",
                      cursor: "pointer",
                      fontSize: 12,
                      borderBottom: "1px solid #f0f0f0",
                    }}
                    onMouseEnter={(e) => {
                      (e.target as HTMLDivElement).style.background = "#f3f4f6";
                    }}
                    onMouseLeave={(e) => {
                      (e.target as HTMLDivElement).style.background = "transparent";
                    }}
                  >
                    #{tag}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                setShowNoteModal(false);
                setNoteText("");
                setEditingNoteId(null);
              }}
              style={{
                padding: "6px 12px",
                border: "1px solid #d4deea",
                borderRadius: 4,
                background: "#fff",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSaveNote}
              disabled={!noteText.trim()}
              style={{
                padding: "6px 12px",
                border: "none",
                borderRadius: 4,
                background: noteText.trim() ? "#3b82f6" : "#d4deea",
                color: "#fff",
                cursor: noteText.trim() ? "pointer" : "not-allowed",
                fontSize: 12,
              }}
            >
              {editingNoteId ? "Update" : "Save"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
