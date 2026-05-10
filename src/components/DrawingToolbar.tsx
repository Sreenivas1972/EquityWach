import React, { useState, useRef, useEffect } from "react";

export type DrawingToolType =
  | "trendline"
  | "extended"
  | "ray"
  | "vertical-line"
  | "andrews-pitchfork"
  | "price-range"
  | "rectangle"
  | "circle"
  | "callout"
  | "anchored-text"
  | "arrow"
  | "channel";

export interface DrawingStyleSettings {
  lineColor: string;
  lineWidth: number;
  lineStyle: number;
  fillColor?: string;
}

export const DEFAULT_STYLE: DrawingStyleSettings = {
  lineColor: "#2563eb",
  lineWidth: 2,
  lineStyle: 0,
};

export function lineStyleToDash(style: number): number[] | undefined {
  switch (style) {
    case 1: return [2, 2];
    case 2: return [5, 5];
    case 3: return [10, 5];
    default: return undefined;
  }
}

interface DrawingToolbarProps {
  selectedTool: DrawingToolType | null;
  onToolSelect: (tool: DrawingToolType | null) => void;
  onClearDrawings: () => void;
  onDeleteSelected: () => void;
  drawingText: string;
  onDrawingTextChange: (text: string) => void;
  styleSettings: DrawingStyleSettings;
  onStyleSettingsChange: (settings: DrawingStyleSettings) => void;
}

interface ToolDefinition {
  id: DrawingToolType;
  label: string;
  anchors: number;
  icon: React.ReactNode;
}

const TrendlineIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="21" x2="21" y2="3" />
  </svg>
);

const ExtendedLineIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="0" y1="21" x2="24" y2="3" strokeDasharray="4 2" />
    <line x1="3" y1="21" x2="21" y2="3" />
  </svg>
);

const RayIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="21" x2="21" y2="3" />
    <line x1="21" y1="3" x2="26" y2="-2" strokeDasharray="4 2" />
  </svg>
);

const VerticalLineIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="0" x2="12" y2="24" />
  </svg>
);

const PitchforkIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="20" x2="12" y2="10" />
    <line x1="12" y1="10" x2="6" y2="4" />
    <line x1="12" y1="10" x2="18" y2="4" />
  </svg>
);

const PriceRangeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="8" y1="4" x2="16" y2="4" />
    <line x1="8" y1="20" x2="16" y2="20" />
    <line x1="12" y1="4" x2="12" y2="20" strokeDasharray="2 2" />
  </svg>
);

const RectangleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="5" width="18" height="14" />
  </svg>
);

const CircleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="9" />
  </svg>
);

const CalloutIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="2" width="14" height="10" rx="2" />
    <polygon points="6,12 8,16 10,12" />
  </svg>
);

const AnchoredTextIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="6" cy="18" r="2" />
    <line x1="6" y1="16" x2="12" y2="6" strokeDasharray="2 2" />
    <text x="10" y="10" fontSize="10" fill="currentColor">A</text>
  </svg>
);

const ArrowIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="21" x2="18" y2="6" />
    <polyline points="18,6 10,6 18,14" />
  </svg>
);

const ChannelIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const TOOLS: ToolDefinition[] = [
  { id: "trendline", label: "Trendline", anchors: 2, icon: <TrendlineIcon /> },
  { id: "extended", label: "Extended Line", anchors: 2, icon: <ExtendedLineIcon /> },
  { id: "ray", label: "Ray", anchors: 2, icon: <RayIcon /> },
  { id: "vertical-line", label: "Vertical Line", anchors: 1, icon: <VerticalLineIcon /> },
  { id: "andrews-pitchfork", label: "Andrews Pitchfork", anchors: 3, icon: <PitchforkIcon /> },
  { id: "price-range", label: "Price Range", anchors: 2, icon: <PriceRangeIcon /> },
  { id: "rectangle", label: "Rectangle", anchors: 2, icon: <RectangleIcon /> },
  { id: "circle", label: "Circle", anchors: 2, icon: <CircleIcon /> },
  { id: "callout", label: "Callout", anchors: 2, icon: <CalloutIcon /> },
  { id: "anchored-text", label: "Anchored Text", anchors: 2, icon: <AnchoredTextIcon /> },
  { id: "arrow", label: "Arrow", anchors: 2, icon: <ArrowIcon /> },
  { id: "channel", label: "Channel", anchors: 3, icon: <ChannelIcon /> },
];

export function DrawingToolbar({ 
  selectedTool, 
  onToolSelect, 
  onClearDrawings, 
  onDeleteSelected, 
  drawingText, 
  onDrawingTextChange,
  styleSettings,
  onStyleSettingsChange,
}: DrawingToolbarProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".toolbar-content")) return;
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  const handleToolClick = (toolId: DrawingToolType) => {
    if (selectedTool === toolId) {
      onToolSelect(null);
    } else {
      onToolSelect(toolId);
      if (toolId !== "callout" && toolId !== "anchored-text") {
        onDrawingTextChange("");
      }
    }
  };

  const isTextTool = selectedTool === "callout" || selectedTool === "anchored-text";

  const selectedToolInfo = TOOLS.find(t => t.id === selectedTool);

  return (
    <div
      ref={toolbarRef}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: 1000,
        userSelect: "none",
      }}
      className="drawing-toolbar"
    >
      <div
        onMouseDown={handleMouseDown}
        style={{
          cursor: isDragging ? "grabbing" : "grab",
          background: "linear-gradient(to bottom, #3a3a3a, #2a2a2a)",
          padding: "8px 12px",
          borderRadius: "6px 6px 0 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #1a1a1a",
        }}
      >
        <span style={{ color: "#fff", fontSize: "12px", fontWeight: 600 }}>Drawing Tools</span>
        <div style={{ display: "flex", gap: "4px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#555" }} />
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#555" }} />
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#555" }} />
        </div>
      </div>

      <div
        className="toolbar-content"
        style={{
          background: "#2a2a2a",
          padding: "8px",
          borderRadius: "0 0 6px 6px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", marginBottom: "8px" }}>
          {TOOLS.map(tool => (
            <button
              key={tool.id}
              onClick={() => handleToolClick(tool.id)}
              title={`${tool.label} (${tool.anchors} anchor${tool.anchors > 1 ? "s" : ""})`}
              style={{
                width: "36px",
                height: "36px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: selectedTool === tool.id ? "#2563eb" : "#1a1a1a",
                border: selectedTool === tool.id ? "2px solid #3b82f6" : "2px solid #333",
                borderRadius: "4px",
                cursor: "pointer",
                color: "#fff",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (selectedTool !== tool.id) {
                  e.currentTarget.style.background = "#333";
                }
              }}
              onMouseLeave={(e) => {
                if (selectedTool !== tool.id) {
                  e.currentTarget.style.background = "#1a1a1a";
                }
              }}
            >
              {tool.icon}
            </button>
          ))}
        </div>

        {selectedToolInfo && (
          <div
            style={{
              background: "#1a1a1a",
              padding: "6px 8px",
              borderRadius: "4px",
              marginBottom: "8px",
              fontSize: "11px",
              color: "#999",
            }}
          >
            <div style={{ color: "#fff", fontWeight: 600, marginBottom: "2px" }}>{selectedToolInfo.label}</div>
            <div>Click {selectedToolInfo.anchors} point{selectedToolInfo.anchors > 1 ? "s" : ""} on chart</div>
          </div>
        )}

        {isTextTool && (
          <div style={{ marginBottom: "8px" }}>
            <input
              type="text"
              value={drawingText}
              onChange={(e) => onDrawingTextChange(e.target.value)}
              placeholder="Enter text..."
              style={{
                width: "100%",
                padding: "6px 8px",
                background: "#1a1a1a",
                border: "1px solid #444",
                borderRadius: "4px",
                color: "#fff",
                fontSize: "12px",
                outline: "none",
              }}
              autoFocus
            />
          </div>
        )}

        <button
          onClick={() => setShowSettings(!showSettings)}
          style={{
            width: "100%",
            padding: "6px 8px",
            background: showSettings ? "#3a3a3a" : "#1a1a1a",
            border: "1px solid #444",
            borderRadius: "4px",
            color: "#fff",
            fontSize: "11px",
            cursor: "pointer",
            marginBottom: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>Style Settings</span>
          <span style={{ 
            transform: showSettings ? "rotate(180deg)" : "rotate(0deg)", 
            transition: "transform 0.2s",
            fontSize: "10px" 
          }}>▼</span>
        </button>

        {showSettings && (
          <div style={{
            background: "#1a1a1a",
            padding: "8px",
            borderRadius: "4px",
            marginBottom: "8px",
          }}>
            <div style={{ marginBottom: "10px" }}>
              <label style={{ display: "block", color: "#999", fontSize: "10px", marginBottom: "4px" }}>Line Color</label>
              <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                <input
                  type="color"
                  value={styleSettings.lineColor}
                  onChange={(e) => onStyleSettingsChange({ ...styleSettings, lineColor: e.target.value })}
                  style={{
                    width: "32px",
                    height: "24px",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    background: "transparent",
                  }}
                />
                <input
                  type="text"
                  value={styleSettings.lineColor}
                  onChange={(e) => onStyleSettingsChange({ ...styleSettings, lineColor: e.target.value })}
                  style={{
                    flex: 1,
                    padding: "4px 6px",
                    background: "#2a2a2a",
                    border: "1px solid #444",
                    borderRadius: "4px",
                    color: "#fff",
                    fontSize: "11px",
                    fontFamily: "monospace",
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: "10px" }}>
              <label style={{ display: "block", color: "#999", fontSize: "10px", marginBottom: "4px" }}>
                Line Width: {styleSettings.lineWidth}px
              </label>
              <input
                type="range"
                min="1"
                max="8"
                value={styleSettings.lineWidth}
                onChange={(e) => onStyleSettingsChange({ ...styleSettings, lineWidth: parseInt(e.target.value) })}
                style={{
                  width: "100%",
                  cursor: "pointer",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", color: "#999", fontSize: "10px", marginBottom: "4px" }}>Line Style</label>
              <select
                value={styleSettings.lineStyle}
                onChange={(e) => onStyleSettingsChange({ ...styleSettings, lineStyle: parseInt(e.target.value) })}
                style={{
                  width: "100%",
                  padding: "4px 6px",
                  background: "#2a2a2a",
                  border: "1px solid #444",
                  borderRadius: "4px",
                  color: "#fff",
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                <option value={0}>Solid</option>
                <option value={1}>Dotted</option>
                <option value={2}>Dashed</option>
                <option value={3}>Large Dashed</option>
              </select>
            </div>

            <div style={{ 
              marginTop: "10px", 
              paddingTop: "8px", 
              borderTop: "1px solid #333",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}>
              <div style={{
                width: "100%",
                height: `${styleSettings.lineWidth}px`,
                background: styleSettings.lineColor,
                borderRadius: "2px",
                borderStyle: styleSettings.lineStyle === 0 ? "solid" : styleSettings.lineStyle === 1 ? "dotted" : "dashed",
              }} />
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: "4px" }}>
          <button
            onClick={onDeleteSelected}
            title="Delete selected drawing"
            style={{
              flex: 1,
              padding: "6px 8px",
              background: "#dc2626",
              border: "none",
              borderRadius: "4px",
              color: "#fff",
              fontSize: "11px",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Delete
          </button>
          <button
            onClick={onClearDrawings}
            title="Clear all drawings"
            style={{
              flex: 1,
              padding: "6px 8px",
              background: "#555",
              border: "none",
              borderRadius: "4px",
              color: "#fff",
              fontSize: "11px",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Clear All
          </button>
        </div>
      </div>
    </div>
  );
}

export function getRequiredAnchors(tool: DrawingToolType): number {
  const toolDef = TOOLS.find(t => t.id === tool);
  return toolDef?.anchors ?? 2;
}
