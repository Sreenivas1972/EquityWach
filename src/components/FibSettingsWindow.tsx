import { useEffect, useState } from "react";
import type { FibToolDefaults } from "../types";
import {
  buildFibSettingsDraft,
  cloneFibToolDefaults,
  DEFAULT_FIB_TOOL_DEFAULTS,
  loadFibSettings,
  parseFibLevelDrafts,
  saveFibSettings,
  type FibSettingsDraft,
} from "../utils/fibSettingsUtils";

interface Props {
  onClose: () => void;
  onSave: (settings: FibToolDefaults) => void;
}

export default function FibSettingsWindow({ onClose, onSave }: Props) {
  const [draft, setDraft] = useState<FibSettingsDraft>(() => buildFibSettingsDraft(DEFAULT_FIB_TOOL_DEFAULTS));
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFibSettings()
      .then((s) => {
        setDraft(buildFibSettingsDraft(s));
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const handleAddLevel = (tool: keyof FibSettingsDraft) => {
    setDraft((prev) => {
      const fallbackSource = prev[tool][prev[tool].length - 1];
      const nextLevel = {
        id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `fib-level-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        enabled: true,
        value: fallbackSource?.value ?? "1",
        color: fallbackSource?.color ?? "#1c7ed6",
      };
      return {
        ...prev,
        [tool]: [...prev[tool], nextLevel],
      };
    });
  };

  const handleUpdateLevel = (tool: keyof FibSettingsDraft, levelId: string, updates: Partial<Pick<FibSettingsDraft["retracement"][0], "enabled" | "value" | "color">>) => {
    setDraft((prev) => ({
      ...prev,
      [tool]: prev[tool].map((level) => (level.id === levelId ? { ...level, ...updates } : level)),
    }));
  };

  const handleReset = () => {
    const resetDefaults = cloneFibToolDefaults(DEFAULT_FIB_TOOL_DEFAULTS);
    setDraft(buildFibSettingsDraft(resetDefaults));
    setMsg("Reset to defaults");
  };

  const handleSave = async () => {
    setMsg("");
    try {
      const nextDefaults: FibToolDefaults = {
        retracement: parseFibLevelDrafts(draft.retracement, DEFAULT_FIB_TOOL_DEFAULTS.retracement),
        extension: parseFibLevelDrafts(draft.extension, DEFAULT_FIB_TOOL_DEFAULTS.extension),
        projection: parseFibLevelDrafts(draft.projection, DEFAULT_FIB_TOOL_DEFAULTS.projection),
      };
      await saveFibSettings(nextDefaults);
      setDraft(buildFibSettingsDraft(nextDefaults));
      onSave(nextDefaults);
      setMsg("Saved.");
    } catch (e) {
      setMsg(`Error: ${e}`);
    }
  };

  const renderFibDraftSection = (tool: keyof FibSettingsDraft, title: string) => {
    return (
      <section className="fib-settings-group">
        <div className="fib-settings-group-head">
          <h3>{title}</h3>
          <button type="button" className="btn-secondary" onClick={() => handleAddLevel(tool)}>
            Add Level
          </button>
        </div>
        <div className="fib-settings-level-list">
          {draft[tool].map((level) => (
            <div key={level.id} className="fib-settings-level-row">
              <label className="fib-settings-enabled-toggle">
                <input
                  type="checkbox"
                  checked={level.enabled}
                  onChange={(e) => handleUpdateLevel(tool, level.id, { enabled: e.target.checked })}
                />
              </label>
              <input
                className="fib-settings-value-input"
                type="text"
                inputMode="decimal"
                value={level.value}
                onChange={(e) => handleUpdateLevel(tool, level.id, { value: e.target.value })}
              />
              <input
                className="fib-settings-color-swatch"
                type="color"
                value={level.color}
                onChange={(e) => handleUpdateLevel(tool, level.id, { color: e.target.value })}
              />
            </div>
          ))}
        </div>
      </section>
    );
  };

  if (loading) {
    return (
      <div className="fib-settings-overlay">
        <div className="fib-settings-panel">
          <div className="fib-settings-header">
            <h2>Fib Settings</h2>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
          <div className="fib-settings-body">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fib-settings-overlay">
      <div className="fib-settings-panel">
        <div className="fib-settings-header">
          <h2>Fib Settings</h2>
          <button className="icon-btn" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="fib-settings-body">
          <p className="fib-settings-hint">
            Configure default Fibonacci levels and colors for retracement, extension, and projection drawings.
          </p>
          {renderFibDraftSection("retracement", "Retracement Levels")}
          {renderFibDraftSection("extension", "Extension Levels")}
          {renderFibDraftSection("projection", "Projection Levels")}
          <div className="fib-settings-actions">
            <button className="btn-secondary" onClick={handleReset}>
              Reset Defaults
            </button>
            <button className="btn-primary" onClick={handleSave}>
              Save
            </button>
          </div>
          {msg && <p className="fib-settings-msg">{msg}</p>}
        </div>
        <p className="fib-settings-status-line">
          Changes affect new Fib drawings. Existing drawings use the levels they were created with.
        </p>
      </div>
    </div>
  );
}
