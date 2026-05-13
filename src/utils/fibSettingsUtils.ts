import { api } from "../services/tauriApi";
import type { FibLevelDefinition, FibToolDefaults } from "../types";

export type FibLevelDraft = {
  id: string;
  enabled: boolean;
  value: string;
  color: string;
};

export type FibSettingsDraft = {
  retracement: FibLevelDraft[];
  extension: FibLevelDraft[];
  projection: FibLevelDraft[];
};

export const DEFAULT_FIB_TOOL_DEFAULTS: FibToolDefaults = {
  retracement: [
    { value: 0, color: "#868e96" },
    { value: 0.236, color: "#1c7ed6" },
    { value: 0.382, color: "#12b886" },
    { value: 0.5, color: "#f59f00" },
    { value: 0.618, color: "#e03131" },
    { value: 0.786, color: "#ae3ec9" },
    { value: 1, color: "#495057" },
  ],
  extension: [
    { value: 0, color: "#868e96" },
    { value: 0.618, color: "#1c7ed6" },
    { value: 1, color: "#12b886" },
    { value: 1.272, color: "#f59f00" },
    { value: 1.618, color: "#e03131" },
    { value: 2, color: "#ae3ec9" },
    { value: 2.618, color: "#7048e8" },
  ],
  projection: [
    { value: 0, color: "#087f5b" },
    { value: 0.618, color: "#1c7ed6" },
    { value: 1, color: "#12b886" },
    { value: 1.272, color: "#f59f00" },
    { value: 1.618, color: "#e03131" },
    { value: 2, color: "#ae3ec9" },
    { value: 2.618, color: "#7048e8" },
  ],
};

export function createFibLevelDraftId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `fib-level-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function buildFibLevelDrafts(levels: FibLevelDefinition[]): FibLevelDraft[] {
  return levels.map((level) => ({
    id: createFibLevelDraftId(),
    enabled: true,
    value: String(level.value),
    color: level.color,
  }));
}

export function buildFibSettingsDraft(defaults: FibToolDefaults): FibSettingsDraft {
  return {
    retracement: buildFibLevelDrafts(defaults.retracement),
    extension: buildFibLevelDrafts(defaults.extension),
    projection: buildFibLevelDrafts(defaults.projection),
  };
}

export function parseFibLevelDrafts(entries: FibLevelDraft[], fallback: FibLevelDefinition[]): FibLevelDefinition[] {
  const normalized = entries
    .map((entry) => {
      if (!entry.enabled) {
        return null;
      }
      const parsedValue = Number(entry.value.trim());
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        return null;
      }

      const value = Number(parsedValue.toFixed(6));
      const fallbackMatch = fallback.find((level) => Math.abs(level.value - value) < 1e-9);
      const fallbackColor = fallbackMatch?.color ?? fallback[0]?.color ?? "#1c7ed6";
      const color = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(entry.color.trim()) ? entry.color.trim().toLowerCase() : fallbackColor;

      return {
        value,
        color,
      };
    })
    .filter((entry): entry is FibLevelDefinition => entry !== null)
    .sort((left, right) => left.value - right.value)
    .filter((entry, index, values) => index === 0 || Math.abs(entry.value - values[index - 1].value) > 1e-9);

  return normalized.length > 0 ? normalized : fallback.map((level) => ({ ...level }));
}

export async function loadFibSettings(): Promise<FibToolDefaults> {
  try {
    const settings = await api.getFibSettings();
    return settings;
  } catch {
    return { ...DEFAULT_FIB_TOOL_DEFAULTS };
  }
}

export async function saveFibSettings(settings: FibToolDefaults): Promise<void> {
  await api.updateFibSettings(settings);
}

export function cloneFibToolDefaults(defaults: FibToolDefaults): FibToolDefaults {
  return {
    retracement: defaults.retracement.map((l) => ({ ...l })),
    extension: defaults.extension.map((l) => ({ ...l })),
    projection: defaults.projection.map((l) => ({ ...l })),
  };
}
