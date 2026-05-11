import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../services/tauriApi";
import type {
  UpstoxAuthStatus,
  FetchSettings,
  RetentionSettings,
  WatchlistEntry,
} from "../types";

interface Props {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: Props) {
  // ── Auth state ────────────────────────────────────────────────────────────
  const [authStatus, setAuthStatus] = useState<UpstoxAuthStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [analyticsToken, setAnalyticsToken] = useState("");
  const [loginMsg, setLoginMsg] = useState("");
  const [analyticsMsg, setAnalyticsMsg] = useState("");
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
  const [newSymbols, setNewSymbols] = useState("");
  const [watchlistMsg, setWatchlistMsg] = useState("");

  // ── Collapsible sections state ────────────────────────────────────────────
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    auth: true,
    retention: true,
    fetchRange: true,
    watchlists: true,
  });

  function toggleSection(section: string) {
    setCollapsedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }

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
    api.getSavedUpstoxCredentials().then((saved) => {
      if (!saved) {
        return;
      }
      setApiKey(saved.api_key);
      setApiSecret(saved.api_secret);
      if (saved.analytics_token) {
        setAnalyticsToken(saved.analytics_token);
      }
      setCredsSaved(true);
    }).catch(() => {});
    api.getRetentionSettings().then(setRetention).catch(() => {});
    api.getFetchSettings().then(setFetchSettings).catch(() => {});
    api.listWatchlists().then(setWatchlists).catch(() => {});
    api.getInstrumentsCount().then(setInstrCount).catch(() => {});
  }, []);

  // ── Listen for Upstox auth completion ──────────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ success: boolean; message: string }>(
      "upstox-auth-complete",
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
      await api.saveUpstoxCredentials(apiKey.trim(), apiSecret.trim());
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
        await api.saveUpstoxCredentials(apiKey.trim(), apiSecret.trim());
        setCredsSaved(true);
        const status = await api.getAuthStatus();
        setAuthStatus(status);
      }

      const msg = await api.upstoxStartLogin();
      setLoginMsg(msg);
    } catch (e) {
      setLoginPending(false);
      setLoginMsg(`Error: ${e}`);
    }
  }

  async function handleLogout() {
    try {
      await api.upstoxLogout();
      setLoginMsg("Logged out.");
      const s = await api.getAuthStatus();
      setAuthStatus(s);
    } catch (e) {
      setLoginMsg(`Error: ${e}`);
    }
  }

  async function handleSaveAnalyticsToken() {
    setAnalyticsMsg("");
    try {
      await api.saveAnalyticsToken(analyticsToken.trim());
      setAnalyticsMsg("Analytics token saved.");
      const s = await api.getAuthStatus();
      setAuthStatus(s);
    } catch (e) {
      setAnalyticsMsg(`Error: ${e}`);
    }
  }

  async function handleClearAnalyticsToken() {
    try {
      await api.clearAnalyticsToken();
      setAnalyticsToken("");
      setAnalyticsMsg("Analytics token cleared.");
      const s = await api.getAuthStatus();
      setAuthStatus(s);
    } catch (e) {
      setAnalyticsMsg(`Error: ${e}`);
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
      const symbols = newSymbols
        .split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      await api.addWatchlist(newName.trim(), symbols);
      setNewName("");
      setNewSymbols("");
      const list = await api.listWatchlists();
      setWatchlists(list);
      setWatchlistMsg(`✓ Watchlist '${newName}' added.`);
    } catch (e) {
      setWatchlistMsg(`Error: ${e}`);
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!newName) {
      setNewName(file.name.replace(/\.[^/.]+$/, ""));
    }

    try {
      const text = await file.text();
      setNewSymbols(text);
    } catch (err) {
      setWatchlistMsg(`Error reading file: ${err}`);
    }
    
    e.target.value = '';
  };

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
        {/* ── Upstox Authentication ─────────────────────────────────────── */}
        <section className="settings-section">
          <div
            className="section-header"
            onClick={() => toggleSection("auth")}
            style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            <h3 style={{ margin: 0 }}>Upstox Authentication</h3>
            <span style={{ fontSize: "0.9em" }}>{collapsedSections.auth ? "▼" : "▲"}</span>
          </div>

          {!collapsedSections.auth && (
            <>
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
              </div>

              <hr style={{ margin: "1rem 0", border: "none", borderTop: "1px solid #333" }} />
              
              <h4 style={{ marginBottom: "0.5rem" }}>Option 1: OAuth Login (Full Access)</h4>
              <div className="form-actions">
                <button
                  className="btn-primary"
                  onClick={handleLogin}
                  disabled={loginPending || !canStartLogin}
                >
                  {loginPending ? "Waiting for browser…" : "Login with Upstox"}
                </button>
                {authStatus?.has_oauth_token && (
                  <button className="btn-danger" onClick={handleLogout}>
                    Logout OAuth
                  </button>
                )}
              </div>
              {loginMsg && <p className="settings-msg">{loginMsg}</p>}
              <p className="settings-hint">
                Register <code>http://127.0.0.1:5050/login</code> as the redirect URL in
                your{" "}
                <a
                  href="https://developer.upstox.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Upstox developer console
                </a>
                .
              </p>

              <hr style={{ margin: "1rem 0", border: "none", borderTop: "1px solid #333" }} />

              <h4 style={{ marginBottom: "0.5rem" }}>Option 2: Analytics Token (Read-Only)</h4>
              <p className="settings-hint">
                Generate a long-lived (1 year) read-only token from the{" "}
                <a
                  href="https://account.upstox.com/developer/apps#analytics"
                  target="_blank"
                  rel="noreferrer"
                >
                  Analytics tab
                </a>{" "}
                in your Upstox Developer Apps page. Supports historical data and market quotes.
              </p>
              <div className="form-row">
                <label>Analytics Token</label>
                <input
                  type="password"
                  value={analyticsToken}
                  placeholder="Enter analytics token (optional)"
                  onChange={(e) => setAnalyticsToken(e.target.value)}
                />
              </div>
              <div className="form-actions">
                <button
                  className="btn-primary"
                  onClick={handleSaveAnalyticsToken}
                  disabled={!analyticsToken.trim()}
                >
                  Save Analytics Token
                </button>
                {authStatus?.has_analytics_token && (
                  <button className="btn-danger" onClick={handleClearAnalyticsToken}>
                    Clear Token
                  </button>
                )}
              </div>
              {analyticsMsg && <p className="settings-msg">{analyticsMsg}</p>}
            </>
          )}
        </section>

        {/* ── Data Retention ──────────────────────────────────────────── */}
        <section className="settings-section">
          <div
            className="section-header"
            onClick={() => toggleSection("retention")}
            style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            <h3 style={{ margin: 0 }}>Data Retention</h3>
            <span style={{ fontSize: "0.9em" }}>{collapsedSections.retention ? "▼" : "▲"}</span>
          </div>
          {!collapsedSections.retention && (
            <>
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
            </>
          )}
        </section>

        {/* ── Default Fetch Range ──────────────────────────────────────── */}
        <section className="settings-section">
          <div
            className="section-header"
            onClick={() => toggleSection("fetchRange")}
            style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            <h3 style={{ margin: 0 }}>Default Fetch Range</h3>
            <span style={{ fontSize: "0.9em" }}>{collapsedSections.fetchRange ? "▼" : "▲"}</span>
          </div>
          {!collapsedSections.fetchRange && (
            <>
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
            </>
          )}
        </section>

        {/* ── Watchlists ───────────────────────────────────────────────── */}
        <section className="settings-section">
          <div
            className="section-header"
            onClick={() => toggleSection("watchlists")}
            style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            <h3 style={{ margin: 0 }}>Watchlists</h3>
            <span style={{ fontSize: "0.9em" }}>{collapsedSections.watchlists ? "▼" : "▲"}</span>
          </div>
          {!collapsedSections.watchlists && (
            <>
              <p className="settings-hint">
                Enter trading symbols, one per line (e.g. <code>INFY</code> or <code>NSE:RELIANCE</code>).
              </p>

              {watchlists.length > 0 && (
                <table className="watchlist-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {watchlists.map((w) => (
                      <tr key={w.name}>
                        <td>{w.name}</td>
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
                <label>Symbols (one per line)</label>
                <textarea
                  value={newSymbols}
                  placeholder="INFY&#10;RELIANCE&#10;TCS"
                  rows={5}
                  onChange={(e) => setNewSymbols(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label>Or import from file</label>
                <input
                  type="file"
                  accept=".txt,.csv"
                  onChange={handleFileSelect}
                />
              </div>
              <div className="form-actions">
                <button
                  className="btn-primary"
                  onClick={handleAddWatchlist}
                  disabled={!newName || !newSymbols.trim()}
                >
                  Add Watchlist
                </button>
              </div>
              {watchlistMsg && <p className="settings-msg">{watchlistMsg}</p>}
            </>
          )}
        </section>

        {/* ── Price Alerts ───────────────────────────────────────────────── */}
        <section className="settings-section">
          <h3>Price Alerts</h3>
          <p className="settings-hint">
            Check all price alerts and create a watchlist with symbols that have triggered alerts.
          </p>
          <div className="form-actions">
            <button className="btn-primary" onClick={() => api.checkPriceAlerts()}>
              Check Price Alerts
            </button>
          </div>
        </section>

        {/* ── Instruments cache ────────────────────────────────────────── */}
        <section className="settings-section">
          <h3>NSE Instruments Cache</h3>
          <p className="settings-hint">
            Symbols are resolved to Upstox instrument keys via a locally cached
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
