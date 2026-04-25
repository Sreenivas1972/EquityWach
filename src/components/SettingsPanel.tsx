import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../services/tauriApi";
import type {
  AuthStatus,
  FetchSettings,
  RetentionSettings,
  WatchlistEntry,
} from "../types";

interface Props {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: Props) {
  // ── Auth state ────────────────────────────────────────────────────────────
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [loginMsg, setLoginMsg] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [credsSaved, setCredsSaved] = useState(false);

  // ── Retention state ───────────────────────────────────────────────────────
  const [retention, setRetention] = useState<RetentionSettings>({
    day_retention_days: 365,
    week_retention_weeks: 104,
    month_retention_months: 60,
  });
  const [retentionMsg, setRetentionMsg] = useState("");
  // ── Fetch settings state ─────────────────────────────────────────────────
  const [fetchSettings, setFetchSettings] = useState<FetchSettings>({
    day_fetch_days: 365,
    week_fetch_weeks: 104,
    month_fetch_months: 60,
  });
  const [fetchMsg, setFetchMsg] = useState("");
  // ── Watchlist state ───────────────────────────────────────────────────────
  const [watchlists, setWatchlists] = useState<WatchlistEntry[]>([]);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [watchlistMsg, setWatchlistMsg] = useState("");

  // ── Instruments state ─────────────────────────────────────────────────────
  const [instrCount, setInstrCount] = useState<number | null>(null);
  const [instrMsg, setInstrMsg] = useState("");
  const [instrLoading, setInstrLoading] = useState(false);
  const hasTypedCredentials = apiKey.trim().length > 0 && apiSecret.trim().length > 0;
  const hasStoredCredentials = Boolean(authStatus?.api_key || credsSaved);
  const canStartLogin = hasStoredCredentials || hasTypedCredentials;

  // ── Load initial data ─────────────────────────────────────────────────────
  useEffect(() => {
    api.getAuthStatus().then(setAuthStatus).catch(() => {});
    api.getSavedKiteCredentials().then((saved) => {
      if (!saved) {
        return;
      }
      setApiKey(saved.api_key);
      setApiSecret(saved.api_secret);
      setCredsSaved(true);
    }).catch(() => {});
    api.getRetentionSettings().then(setRetention).catch(() => {});
    api.getFetchSettings().then(setFetchSettings).catch(() => {});
    api.listWatchlists().then(setWatchlists).catch(() => {});
    api.getInstrumentsCount().then(setInstrCount).catch(() => {});
  }, []);

  // ── Listen for Kite auth completion ──────────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ success: boolean; message: string }>(
      "kite-auth-complete",
      (event) => {
        setLoginPending(false);
        if (event.payload.success) {
          setLoginMsg("✓ Authentication successful!");
          api.getAuthStatus().then(setAuthStatus).catch(() => {});
        } else {
          setLoginMsg(`✗ ${event.payload.message}`);
        }
      }
    ).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // ── Handlers: auth ────────────────────────────────────────────────────────
  async function handleSaveCredentials() {
    try {
      await api.saveKiteCredentials(apiKey.trim(), apiSecret.trim());
      setCredsSaved(true);
      setLoginMsg("Credentials saved.");
      const s = await api.getAuthStatus();
      setAuthStatus(s);
    } catch (e) {
      setLoginMsg(`Error: ${e}`);
    }
  }

  async function handleLogin() {
    setLoginMsg("");
    setLoginPending(true);
    try {
      if (hasTypedCredentials) {
        await api.saveKiteCredentials(apiKey.trim(), apiSecret.trim());
        setCredsSaved(true);
        const status = await api.getAuthStatus();
        setAuthStatus(status);
      }

      const msg = await api.kiteStartLogin();
      setLoginMsg(msg);
    } catch (e) {
      setLoginPending(false);
      setLoginMsg(`Error: ${e}`);
    }
  }

  async function handleLogout() {
    try {
      await api.kiteLogout();
      setLoginMsg("Logged out.");
      const s = await api.getAuthStatus();
      setAuthStatus(s);
    } catch (e) {
      setLoginMsg(`Error: ${e}`);
    }
  }

  // ── Handlers: retention ───────────────────────────────────────────────────
  async function handleSaveRetention() {
    setRetentionMsg("");
    try {
      const pruned = await api.updateRetentionSettings(retention);
      setRetentionMsg(`Saved. ${pruned} old candles pruned.`);
    } catch (e) {
      setRetentionMsg(`Error: ${e}`);
    }
  }

  // ── Handlers: fetch settings ───────────────────────────────────────────────
  async function handleSaveFetchSettings() {
    setFetchMsg("");
    try {
      await api.updateFetchSettings(fetchSettings);
      setFetchMsg("Saved.");
    } catch (e) {
      setFetchMsg(`Error: ${e}`);
    }
  }

  // ── Handlers: watchlists ──────────────────────────────────────────────────
  async function handleAddWatchlist() {
    setWatchlistMsg("");
    try {
      await api.addWatchlist(newName.trim(), newPath.trim());
      setNewName("");
      setNewPath("");
      const list = await api.listWatchlists();
      setWatchlists(list);
      setWatchlistMsg(`✓ Watchlist '${newName}' added.`);
    } catch (e) {
      setWatchlistMsg(`Error: ${e}`);
    }
  }

  async function handleRemoveWatchlist(name: string) {
    setWatchlistMsg("");
    try {
      await api.removeWatchlist(name);
      const list = await api.listWatchlists();
      setWatchlists(list);
    } catch (e) {
      setWatchlistMsg(`Error: ${e}`);
    }
  }

  // ── Handlers: instruments ─────────────────────────────────────────────────
  async function handleRefreshInstruments() {
    setInstrMsg("");
    setInstrLoading(true);
    try {
      const count = await api.refreshInstruments();
      setInstrCount(count);
      setInstrMsg(`✓ ${count.toLocaleString()} NSE EQ instruments cached.`);
    } catch (e) {
      setInstrMsg(`Error: ${e}`);
    } finally {
      setInstrLoading(false);
    }
  }

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="icon-btn" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      <div className="settings-body">
        {/* ── Kite Authentication ─────────────────────────────────────── */}
        <section className="settings-section">
          <h3>Kite Authentication</h3>

          {authStatus && (
            <div
              className={`auth-status-badge ${authStatus.is_authenticated ? "auth-ok" : "auth-no"}`}
            >
              {authStatus.is_authenticated ? "✓ Authenticated" : "✗ Not authenticated"}
              <span className="auth-status-msg">{authStatus.message}</span>
            </div>
          )}

          <div className="form-row">
            <label>API Key</label>
            <input
              type="text"
              value={apiKey}
              placeholder={authStatus?.api_key ?? "Enter API key"}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label>API Secret</label>
            <input
              type="password"
              value={apiSecret}
              placeholder="Enter API secret"
              onChange={(e) => setApiSecret(e.target.value)}
            />
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={handleSaveCredentials}
              disabled={!apiKey || !apiSecret}>
              Save Credentials
            </button>
            <button
              className="btn-primary"
              onClick={handleLogin}
              disabled={loginPending || !canStartLogin}
            >
              {loginPending ? "Waiting for browser…" : "Login with Kite"}
            </button>
            {authStatus?.is_authenticated && (
              <button className="btn-danger" onClick={handleLogout}>
                Logout
              </button>
            )}
          </div>
          {loginMsg && <p className="settings-msg">{loginMsg}</p>}
          <p className="settings-hint">
            Register <code>http://127.0.0.1:6010/login</code> as the redirect URL in
            your{" "}
            <a
              href="https://developers.kite.trade/apps"
              target="_blank"
              rel="noreferrer"
            >
              Kite developer console
            </a>
            .
          </p>
        </section>

        {/* ── Data Retention ──────────────────────────────────────────── */}
        <section className="settings-section">
          <h3>Data Retention</h3>
          <p className="settings-hint">
            Downloaded candles older than these limits will be pruned when you
            save.
          </p>

          <div className="form-row">
            <label>Daily data (days)</label>
            <input
              type="number"
              min={7}
              max={3650}
              value={retention.day_retention_days}
              onChange={(e) =>
                setRetention((r) => ({
                  ...r,
                  day_retention_days: parseInt(e.target.value) || 365,
                }))
              }
            />
          </div>
          <div className="form-row">
            <label>Weekly data (weeks)</label>
            <input
              type="number"
              min={4}
              max={520}
              value={retention.week_retention_weeks}
              onChange={(e) =>
                setRetention((r) => ({
                  ...r,
                  week_retention_weeks: parseInt(e.target.value) || 104,
                }))
              }
            />
          </div>
          <div className="form-row">
            <label>Monthly data (months)</label>
            <input
              type="number"
              min={1}
              max={240}
              value={retention.month_retention_months}
              onChange={(e) =>
                setRetention((r) => ({
                  ...r,
                  month_retention_months: parseInt(e.target.value) || 60,
                }))
              }
            />
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={handleSaveRetention}>
              Save &amp; Prune
            </button>
          </div>
          {retentionMsg && <p className="settings-msg">{retentionMsg}</p>}
        </section>

        {/* ── Default Fetch Range ──────────────────────────────────────── */}
        <section className="settings-section">
          <h3>Default Fetch Range</h3>
          <p className="settings-hint">
            How much history to download the first time you open a chart for a
            symbol. Applies only when there is no cached data yet.
          </p>

          <div className="form-row">
            <label>Daily chart (days)</label>
            <input
              type="number"
              min={1}
              max={3650}
              value={fetchSettings.day_fetch_days}
              onChange={(e) =>
                setFetchSettings((f) => ({
                  ...f,
                  day_fetch_days: parseInt(e.target.value) || 365,
                }))
              }
            />
          </div>
          <div className="form-row">
            <label>Weekly chart (weeks)</label>
            <input
              type="number"
              min={1}
              max={520}
              value={fetchSettings.week_fetch_weeks}
              onChange={(e) =>
                setFetchSettings((f) => ({
                  ...f,
                  week_fetch_weeks: parseInt(e.target.value) || 104,
                }))
              }
            />
          </div>
          <div className="form-row">
            <label>Monthly chart (months)</label>
            <input
              type="number"
              min={1}
              max={240}
              value={fetchSettings.month_fetch_months}
              onChange={(e) =>
                setFetchSettings((f) => ({
                  ...f,
                  month_fetch_months: parseInt(e.target.value) || 60,
                }))
              }
            />
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={handleSaveFetchSettings}>
              Save
            </button>
          </div>
          {fetchMsg && <p className="settings-msg">{fetchMsg}</p>}
        </section>

        {/* ── Watchlists ───────────────────────────────────────────────── */}
        <section className="settings-section">
          <h3>Watchlists</h3>
          <p className="settings-hint">
            Each watchlist maps a name to a CSV file (one trading symbol per
            line, e.g. <code>INFY</code> or <code>NSE:RELIANCE</code>).
          </p>

          {watchlists.length > 0 && (
            <table className="watchlist-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>File path</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {watchlists.map((w) => (
                  <tr key={w.name}>
                    <td>{w.name}</td>
                    <td className="path-cell" title={w.file_path}>
                      {w.file_path}
                    </td>
                    <td>
                      <button
                        className="btn-danger-sm"
                        onClick={() => handleRemoveWatchlist(w.name)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="form-row">
            <label>Name</label>
            <input
              type="text"
              value={newName}
              placeholder="e.g. My Stocks"
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label>CSV file path</label>
            <input
              type="text"
              value={newPath}
              placeholder="/path/to/symbols.csv"
              onChange={(e) => setNewPath(e.target.value)}
            />
          </div>
          <div className="form-actions">
            <button
              className="btn-primary"
              onClick={handleAddWatchlist}
              disabled={!newName || !newPath}
            >
              Add Watchlist
            </button>
          </div>
          {watchlistMsg && <p className="settings-msg">{watchlistMsg}</p>}
        </section>

        {/* ── Instruments cache ────────────────────────────────────────── */}
        <section className="settings-section">
          <h3>NSE Instruments Cache</h3>
          <p className="settings-hint">
            Symbols are resolved to Kite instrument tokens via a locally cached
            copy of the NSE instruments list. Refresh after adding new symbols.
          </p>
          {instrCount !== null && (
            <p className="settings-hint">
              Cached instruments: <strong>{instrCount.toLocaleString()}</strong>
            </p>
          )}
          <div className="form-actions">
            <button
              className="btn-primary"
              onClick={handleRefreshInstruments}
              disabled={instrLoading || !authStatus?.is_authenticated}
            >
              {instrLoading ? "Refreshing…" : "Refresh Instruments"}
            </button>
          </div>
          {instrMsg && <p className="settings-msg">{instrMsg}</p>}
        </section>
      </div>
    </div>
  );
}
