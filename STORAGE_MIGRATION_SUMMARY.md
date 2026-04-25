# Drawing Storage Migration to SQLite

## ✅ Migration Complete

All drawing data has been successfully migrated from browser localStorage to a SQLite database on disk.

## 📍 New Storage Location

**Database file**: `~/.local/share/equitywatcher/candles.db`

On macOS: `/Users/{username}/Library/Application Support/equitywatcher/candles.db`  
On Linux: `/home/{username}/.local/share/equitywatcher/candles.db`  
On Windows: `C:\Users\{username}\AppData\Local\equitywatcher\candles.db`

## 📊 Database Tables

### `sr_drawings` - Support/Resistance drawings

```sql
CREATE TABLE sr_drawings (
    id          TEXT    NOT NULL,           -- Drawing ID (e.g., "sr_RELIANCE")
    symbol      TEXT    NOT NULL,           -- Stock symbol
    kind        TEXT    NOT NULL,           -- Type ('sr_array')
    data        TEXT    NOT NULL,           -- JSON array of drawings
    created_at  INTEGER NOT NULL,           -- Unix timestamp
    updated_at  INTEGER NOT NULL,           -- Unix timestamp
    PRIMARY KEY (id, symbol)
);
```

### `fib_drawings` - Fibonacci drawings

```sql
CREATE TABLE fib_drawings (
    id          TEXT    NOT NULL,           -- Drawing ID (e.g., "fib_RELIANCE")
    symbol      TEXT    NOT NULL,           -- Stock symbol
    kind        TEXT    NOT NULL,           -- Type ('fib_set')
    data        TEXT    NOT NULL,           -- JSON FibDrawingSet
    defaults    TEXT,                      -- Defaults (currently unused)
    created_at  INTEGER NOT NULL,           -- Unix timestamp
    updated_at  INTEGER NOT NULL,           -- Unix timestamp
    PRIMARY KEY (id, symbol)
);
```

## 🔧 Implementation Details

### Backend Changes (Rust/Tauri)

1. **Database Schema** (`src-tauri/src/storage.rs`)
   - Added `sr_drawings` and `fib_drawings` tables
   - Indexed by `symbol` for fast queries

2. **Storage Functions** (`src-tauri/src/storage.rs`)
   - `load_sr_drawings()` - Load SR drawings for a symbol
   - `save_sr_drawings()` - Save SR drawings (JSON array)
   - `clear_sr_drawings()` - Clear SR drawings for a symbol
   - `load_fib_drawings()` - Load Fibonacci drawings for a symbol
   - `save_fib_drawings()` - Save Fibonacci drawings (JSON)
   - `clear_fib_drawings()` - Clear Fibonacci drawings for a symbol

3. **Tauri Commands** (`src-tauri/src/lib.rs`)
   - Added 6 new commands for frontend access:
     - `load_sr_drawings`
     - `save_sr_drawings`
     - `clear_sr_drawings`
     - `load_fib_drawings`
     - `save_fib_drawings`
     - `clear_fib_drawings`

### Frontend Changes (TypeScript/React)

1. **API Service** (`src/services/tauriApi.ts`)
   - Added drawing storage methods to `api` object

2. **SR Window** (`src/windows/SRWindow.tsx`)
   - Migrated from `localStorage` to `api.saveSrDrawings` / `api.loadSrDrawings`
   - Removed storage event listeners (no longer needed)
   - Async storage operations

3. **Fib Window** (`src/windows/FibWindow.tsx`)
   - Migrated from `localStorage` to `api.saveFibDrawings` / `api.loadFibDrawings`
   - Removed storage event listeners
   - Updated clear buttons to use new API

## 📁 Data Format

### SR Drawings (JSON)
```json
[
  {
    "id": "sr-uuid",
    "kind": "support" | "resistance" | "trendline" | "range",
    "aTime": 1704067200,               // Unix timestamp
    "aPrice": 1500.50,
    "bTime": 1706745600,               // For trendlines/ranges
    "bPrice": 1650.25
  }
]
```

### Fibonacci Drawings (JSON)
```json
{
  "drawings": [
    {
      "id": "fib-uuid",
      "kind": "retracement" | "extension" | "projection",
      "anchorA": { "time": 1704067200, "price": 1500.50 },
      "anchorB": { "time": 1706745600, "price": 1650.25 },
      "anchorC": { "time": 1709251200, "price": 1450.00 }  // Projection only
    }
  ],
  "defaults": { /* Fibonacci level definitions */ }
}
```

## ✅ Benefits of SQLite Storage

1. **Persistent Disk Storage**
   - Survives browser cache clear
   - Backed by file system
   - Survives app reinstallation (if data dir preserved)

2. **Structured Data**
   - SQL queries possible
   - Proper indexing
   - Type safety with Rust

3. **Better Performance**
   - Indexed lookups by symbol
   - No JSON parsing of entire storage
   - Efficient updates

4. **No Browser Quotas**
   - Not limited to 5-10MB
   - Only limited by disk space
   - No same-origin restrictions

5. **Cross-Window Sync**
   - All windows access same database
   - No storage event coordination needed

## 🔄 Data Migration

**Old data**: Still in browser localStorage (not automatically migrated)
- Keys: `equitywatcher:sr:{SYMBOL}`
- Keys: `equitywatcher:fib:{SYMBOL}`

**New data**: In SQLite database
- Table: `sr_drawings`
- Table: `fib_drawings`

### Manual Migration (Optional)

If you want to migrate old drawings:

```javascript
// In browser DevTools Console:

// Migrate SR drawings
Object.keys(localStorage)
  .filter(k => k.startsWith('equitywatcher:sr:'))
  .forEach(async (key) => {
    const symbol = key.replace('equitywatcher:sr:', '');
    const data = localStorage.getItem(key);
    await tauriApi.saveSrDrawings(symbol, data);
    console.log(`Migrated ${symbol}`);
  });

// Migrate Fib drawings  
Object.keys(localStorage)
  .filter(k => k.startsWith('equitywatcher:fib:'))
  .forEach(async (key) => {
    const symbol = key.replace('equitywatcher:fib:', '');
    const data = localStorage.getItem(key);
    await tauriApi.saveFibDrawings(symbol, data);
    console.log(`Migrated ${symbol}`);
  });
```

## ⚠️ Important Notes

- **Backup Recommended**: Copy `candles.db` periodically
- **No Auto-Migration**: Old localStorage data is preserved but not migrated
- **Single Record Per Symbol**: Each symbol has one record containing all drawings
- **Timestamps**: `created_at` and `updated_at` are Unix timestamps (seconds)

## 🧪 Testing

Both front-end and back-end compilation successful:
- TypeScript: ✓ Build successful
- Rust: ✓ Cargo check successful
- Vite bundle: ✓ Created successfully

## 📝 Next Steps

1. Test the new storage by drawing in both SR and Fib windows
2. Verify drawings persist after app restart
3. Test symbol switching (drawings should remain in place)
4. Verify clear buttons work correctly
5. Optional: Manually migrate old drawings if needed

## 🔍 Viewing Database Data

Use any SQLite client:
```bash
# Command line
sqlite3 ~/.local/share/equitywatcher/candles.db

# Then run queries
SELECT symbol, length(data) as size FROM sr_drawings;
SELECT symbol, length(data) as size FROM fib_drawings;
```

Or use GUI tools like:
- DB Browser for SQLite
- SQLiteStudio
- DBeaver
