# Fibonacci & SR Window Persistent Storage Guide

## Overview

This document explains how to access and manage persistent storage for drawings in Fibonacci and SR (Support/Resistance) windows.

## Storage Location

All drawing data is stored in **browser localStorage** (not files on disk). This means:
- Data persists across browser sessions
- Data is specific to each browser/user profile
- Data can be accessed via Developer Tools
- Storage quotas apply (typically 5-10MB per origin)

## Fibonacci Window Storage

### Key Format
```
equitywatcher:fib:{SYMBOL}
```

### Example Keys
```
equitywatcher:fib:RELIANCE
equitywatcher:fib:TCS
equitywatcher:fib:NIFTY
```

### Data Structure
```typescript
{
  "drawings": [
    {
      "id": "fib-{uuid}",
      "kind": "retracement" | "extension" | "projection",
      "anchorA": {
        "time": 1704067200,  // Unix timestamp
        "price": 1500.50
      },
      "anchorB": {
        "time": 1706745600,
        "price": 1650.25
      },
      "anchorC": {           // Only for projection
        "time": 1709251200,
        "price": 1450.00
      }
    }
  ],
  "defaults": {
    "retracement": [
      { "value": 0, "color": "#1c7ed6" },
      { "value": 0.236, "color": "#2b8a3e" },
      // ... more levels
    ],
    "extension": [ /* ... */ ],
    "projection": [ /* ... */ ]
  }
}
```

## SR Window Storage

### Key Format
```
equitywatcher:sr:{SYMBOL}
```

### Example Keys
```
equitywatcher:sr:RELIANCE
equitywatcher:sr:TCS
equitywatcher:sr:NIFTY
```

### Data Structure
```typescript
[
  // Support/Resistance Line
  {
    "id": "sr-{uuid}",
    "kind": "support" | "resistance",
    "price": 1534.75
  },
  // Trendline
  {
    "id": "trend-{uuid}",
    "kind": "trendline",
    "aTime": 1704067200,  // Unix timestamp
    "aPrice": 1500.50,
    "bTime": 1706745600,
    "bPrice": 1650.25
  },
  // Range
  {
    "id": "range-{uuid}",
    "kind": "range",
    "aTime": 1704067200,
    "aPrice": 1600.00,
    "bTime": 1706745600,
    "bPrice": 1450.00
  }
]
```

## Accessing Storage

### Method 1: Browser Developer Tools (Easiest)

1. **Open Fibonacci/SR Window**
   - Right-click inside the window
   - Select "Inspect" or "Inspect Element"

2. **Navigate to Application Tab**
   - Click "Application" in DevTools
   - Expand "Local Storage" in left sidebar
   - Select your application URL (e.g., `tauri://localhost`)

3. **View/Edit Data**
   - Find keys starting with `equitywatcher:fib:` or `equitywatcher:sr:`
   - Click on a key to view its JSON value
   - Double-click the value to edit

### Method 2: JavaScript Console Commands

```javascript
// List all Fibonacci keys
Object.keys(localStorage)
  .filter(k => k.startsWith('equitywatcher:fib:'))
  .sort();

// List all SR keys
Object.keys(localStorage)
  .filter(k => k.startsWith('equitywatcher:sr:'))
  .sort();

// View specific symbol's drawings
localStorage.getItem('equitywatcher:fib:RELIANCE');
localStorage.getItem('equitywatcher:sr:TCS');

// Pretty print JSON
console.log(JSON.stringify(
  JSON.parse(localStorage.getItem('equitywatcher:fib:RELIANCE')), 
  null, 
  2
));

// Count total drawings per symbol
const fibData = JSON.parse(localStorage.getItem('equitywatcher:fib:RELIANCE'));
console.log(`RELIANCE: ${fibData.drawings.length} Fibonacci drawings`);

const srData = JSON.parse(localStorage.getItem('equitywatcher:sr:RELIANCE'));
console.log(`RELIANCE: ${srData.length} SR drawings`);
```

### Method 3: Export All Data

```javascript
// Export all Fibonacci data to JSON
const fibExport = {};
Object.keys(localStorage)
  .filter(k => k.startsWith('equitywatcher:fib:'))
  .forEach(k => {
    fibExport[k] = JSON.parse(localStorage.getItem(k));
  });
  
const fibJson = JSON.stringify(fibExport, null, 2);
console.log(fibJson);
// Copy from console and save to file

// Export all SR data to JSON
const srExport = {};
Object.keys(localStorage)
  .filter(k => k.startsWith('equitywatcher:sr:'))
  .forEach(k => {
    srExport[k] = JSON.parse(localStorage.getItem(k));
  });
  
const srJson = JSON.stringify(srExport, null, 2);
console.log(srJson);
// Copy from console and save to file
```

## Managing Storage

### Backup Drawings

```javascript
// Manual backup (run in console)
function backupDrawings() {
  const backup = {
    timestamp: new Date().toISOString(),
    fib: {},
    sr: {}
  };
  
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('equitywatcher:fib:')) {
      backup.fib[k] = JSON.parse(localStorage.getItem(k));
    }
    if (k.startsWith('equitywatcher:sr:')) {
      backup.sr[k] = JSON.parse(localStorage.getItem(k));
    }
  });
  
  const blob = new Blob([JSON.stringify(backup, null, 2)], 
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `drawings-backup-${Date.now()}.json`;
  a.click();
}

backupDrawings();
```

### Clear All Drawings

```javascript
// DANGER: This cannot be undone!

// Clear all Fibonacci drawings
Object.keys(localStorage).forEach(k => {
  if (k.startsWith('equitywatcher:fib:')) {
    localStorage.removeItem(k);
  }
});

// Clear all SR drawings
Object.keys(localStorage).forEach(k => {
  if (k.startsWith('equitywatcher:sr:')) {
    localStorage.removeItem(k);
  }
});

// Clear everything (including other app data)
localStorage.clear();
```

### Clear Specific Symbol

```javascript
// Remove drawings for a specific symbol
localStorage.removeItem('equitywatcher:fib:RELIANCE');
localStorage.removeItem('equitywatcher:sr:RELIANCE');
```

## Storage Limits & Considerations

- **Browser Limit**: Typically 5-10MB per origin
- **No File System**: Data is NOT saved to `.txt` files on disk
- **Per-Browser**: Data stored in Chrome ≠ Firefox ≠ Safari
- **Clearing Cache**: Clearing browser data WILL erase drawings
- **Backup Recommended**: Export regularly to avoid data loss
- **Sync**: No built-in cloud sync (manual backup/restore required)

## Troubleshooting

### "I can't find my drawings"
- Check you're in the same browser/profile
- Verify localStorage hasn't been cleared
- Look for correct symbol keys

### "Drawings are corrupted"
- localStorage may have been manually edited incorrectly
- Restore from backup JSON
- Or clear and redraw

### "Storage is full"
- Export and backup old drawings
- Remove unused symbol keys
- Clear browser data for the origin

## For Developers

### Storage Key Patterns (Regex)
```javascript
// Fibonacci keys
/^equitywatcher:fib:.+/

// SR keys  
/^equitywatcher:sr:.+/
```

### Code References
- **Fibonacci**: `src/windows/FibWindow.tsx` lines 76-98
- **SR Window**: `src/windows/SRWindow.tsx` lines 51-69
- **Shared time conversion**: `src/windows/shared.ts`

---

**Remember**: All drawing data is stored in the browser's localStorage, not in files on your computer's disk.