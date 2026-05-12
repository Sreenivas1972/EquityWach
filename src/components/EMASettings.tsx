import { useEffect, useState } from "react";
import { api } from "../services/tauriApi";
import type { EMASettings as EMASettingsType } from "../types";

interface Props {
  onClose: () => void;
  onSave: (settings: EMASettingsType) => void;
}

const DEFAULT_SETTINGS: EMASettingsType = {
  ema1_period: 20,
  ema2_period: 50,
  ema3_period: 200,
  ema1_color: "#f08c00",
  ema2_color: "#228be6",
  ema3_color: "#c2255c",
};

export default function EMASettings({ onClose, onSave }: Props) {
  const [settings, setSettings] = useState<EMASettingsType>(DEFAULT_SETTINGS);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getEMASettings()
      .then((s) => {
        setSettings(s);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  async function handleSave() {
    setMsg("");
    try {
      await api.updateEMASettings(settings);
      setMsg("Saved.");
      onSave(settings);
    } catch (e) {
      setMsg(`Error: ${e}`);
    }
  }

  function handleReset() {
    setSettings(DEFAULT_SETTINGS);
  }

  if (loading) {
    return (
      <div className="ema-settings-overlay">
        <div className="ema-settings-panel">
          <div className="ema-settings-header">
            <h2>EMA Settings</h2>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
          <div className="ema-settings-body">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ema-settings-overlay">
      <div className="ema-settings-panel">
        <div className="ema-settings-header">
          <h2>EMA Settings</h2>
          <button className="icon-btn" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="ema-settings-body">
          <p className="ema-settings-hint">
            Configure the periods and colors for the three EMA lines displayed on the chart.
          </p>

          <div className="ema-settings-row">
            <label>EMA 1 Period</label>
            <input
              type="number"
              min={1}
              max={500}
              value={settings.ema1_period}
              onChange={(e) =>
                setSettings((s) => ({ ...s, ema1_period: parseInt(e.target.value) || 20 }))
              }
            />
            <input
              type="color"
              value={settings.ema1_color}
              onChange={(e) =>
                setSettings((s) => ({ ...s, ema1_color: e.target.value }))
              }
              title="EMA 1 Color"
            />
          </div>

          <div className="ema-settings-row">
            <label>EMA 2 Period</label>
            <input
              type="number"
              min={1}
              max={500}
              value={settings.ema2_period}
              onChange={(e) =>
                setSettings((s) => ({ ...s, ema2_period: parseInt(e.target.value) || 50 }))
              }
            />
            <input
              type="color"
              value={settings.ema2_color}
              onChange={(e) =>
                setSettings((s) => ({ ...s, ema2_color: e.target.value }))
              }
              title="EMA 2 Color"
            />
          </div>

          <div className="ema-settings-row">
            <label>EMA 3 Period</label>
            <input
              type="number"
              min={1}
              max={500}
              value={settings.ema3_period}
              onChange={(e) =>
                setSettings((s) => ({ ...s, ema3_period: parseInt(e.target.value) || 200 }))
              }
            />
            <input
              type="color"
              value={settings.ema3_color}
              onChange={(e) =>
                setSettings((s) => ({ ...s, ema3_color: e.target.value }))
              }
              title="EMA 3 Color"
            />
          </div>

          <div className="ema-settings-actions">
            <button className="btn-secondary" onClick={handleReset}>
              Reset to Defaults
            </button>
            <button className="btn-primary" onClick={handleSave}>
              Save
            </button>
          </div>

          {msg && <p className="ema-settings-msg">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
