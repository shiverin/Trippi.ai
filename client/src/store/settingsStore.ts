import { create } from 'zustand';
import { settingsApi } from '../api/client';
import { SUPPORTED_LANGUAGE_CODES } from '../i18n/supportedLanguages';
import type { Settings } from '../types';
import { getApiErrorMessage } from '../types';

const UNSET_SETTING = Symbol('unset-setting');
type SettingsKey = keyof Settings;
type SettingsValue = Settings[SettingsKey];
type SettingSnapshot = SettingsValue | typeof UNSET_SETTING;

let pendingSaveId = 0;
const pendingSaves = new Map<SettingsKey, PendingSettingSave[]>();
const latestSaveByKey = new Map<SettingsKey, number>();

interface PendingSettingSave {
  id: number;
  previous: SettingSnapshot;
  previousLanguageStorage?: string | null;
}

interface SettingsState {
  settings: Settings;
  isLoaded: boolean;

  loadSettings: () => Promise<void>;
  updateSetting: (key: keyof Settings, value: Settings[keyof Settings]) => Promise<void>;
  setLanguageLocal: (lang: string) => void;
  setLanguageTransient: (lang: string) => void;
  updateSettings: (settingsObj: Partial<Settings>) => Promise<void>;
}

// Returns true when the user has explicitly chosen a language (persisted in localStorage).
// Use this instead of reading localStorage directly so the key stays encapsulated here.
export const hasStoredLanguage = (): boolean =>
  typeof localStorage !== 'undefined' && !!localStorage.getItem('app_language');

function readSettingSnapshot(settings: Settings, key: SettingsKey): SettingSnapshot {
  return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : UNSET_SETTING;
}

function applySettingSnapshot(settings: Settings, key: SettingsKey, snapshot: SettingSnapshot): Settings {
  const next = { ...settings };
  if (snapshot === UNSET_SETTING) {
    delete (next as Partial<Settings>)[key];
  } else {
    (next as Record<string, unknown>)[key] = snapshot;
  }
  return next;
}

function getLanguageStorage(): string | null {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem('app_language');
}

function restoreLanguageStorage(value: string | null | undefined): void {
  if (typeof localStorage === 'undefined') return;
  if (value == null) localStorage.removeItem('app_language');
  else localStorage.setItem('app_language', value);
}

function trackPendingSave(key: SettingsKey, previous: SettingSnapshot): PendingSettingSave {
  const entry: PendingSettingSave = {
    id: ++pendingSaveId,
    previous,
    previousLanguageStorage: key === 'language' ? getLanguageStorage() : undefined,
  };
  latestSaveByKey.set(key, entry.id);
  const stack = pendingSaves.get(key) ?? [];
  stack.push(entry);
  pendingSaves.set(key, stack);
  return entry;
}

function finishPendingSave(key: SettingsKey, entry: PendingSettingSave): void {
  const stack = pendingSaves.get(key);
  if (!stack) return;
  const index = stack.findIndex((candidate) => candidate.id === entry.id);
  if (index === -1) return;
  stack.splice(index, 1);
  if (stack.length === 0) pendingSaves.delete(key);
}

function rollbackPendingSave(key: SettingsKey, entry: PendingSettingSave, set: (fn: (state: SettingsState) => Partial<SettingsState>) => void): void {
  const stack = pendingSaves.get(key);
  if (!stack) return;
  const index = stack.findIndex((candidate) => candidate.id === entry.id);
  if (index === -1) return;

  const nextEntry = stack[index + 1];
  if (nextEntry) {
    nextEntry.previous = entry.previous;
    if (key === 'language') nextEntry.previousLanguageStorage = entry.previousLanguageStorage;
  }
  stack.splice(index, 1);
  if (stack.length === 0) pendingSaves.delete(key);

  if (latestSaveByKey.get(key) !== entry.id) return;

  set((state) => ({
    settings: applySettingSnapshot(state.settings, key, entry.previous),
  }));
  if (key === 'language') restoreLanguageStorage(entry.previousLanguageStorage);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {
    map_tile_url: '',
    default_lat: 48.8566,
    default_lng: 2.3522,
    default_zoom: 10,
    dark_mode: false,
    default_currency: 'USD',
    language: localStorage.getItem('app_language') || 'en',
    temperature_unit: 'celsius',
    distance_unit: 'metric',
    time_format: '12h',
    show_place_description: false,
    optimize_from_accommodation: true,
    map_provider: 'leaflet',
    map_poi_pill_enabled: true,
    mapbox_style: 'mapbox://styles/mapbox/standard',
    maplibre_style: '',
    mapbox_3d_enabled: true,
    mapbox_quality_mode: false,
    dashboard_fx_from: 'EUR',
    dashboard_fx_to: 'USD',
    // dashboard_timezones is intentionally left unset so the widget can tell "never
    // chosen" (fall back to home + defaults) from an explicitly emptied list.
  },
  isLoaded: false,

  loadSettings: async () => {
    try {
      const data = await settingsApi.get();
      set((state) => ({
        settings: { ...state.settings, ...data.settings },
        isLoaded: true,
      }));
    } catch (err: unknown) {
      set({ isLoaded: true });
      if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
        console.warn('Failed to load settings:', err);
      }
    }
  },

  updateSetting: async (key: keyof Settings, value: Settings[keyof Settings]) => {
    const previous = readSettingSnapshot(get().settings, key);
    const pending = trackPendingSave(key, previous);
    set((state) => ({
      settings: { ...state.settings, [key]: value },
    }));
    if (key === 'language') localStorage.setItem('app_language', value as string);
    try {
      await settingsApi.set(key, value);
      finishPendingSave(key, pending);
    } catch (err: unknown) {
      rollbackPendingSave(key, pending, set);
      console.error('Failed to save setting:', err);
      throw new Error(getApiErrorMessage(err, 'Error saving setting'));
    }
  },

  setLanguageLocal: (lang: string) => {
    localStorage.setItem('app_language', lang);
    set((state) => ({ settings: { ...state.settings, language: lang } }));
  },

  // Applies a language for the current session without persisting to localStorage.
  // Used for automatic detection (browser/server default) — only explicit user
  // choices via the UI should be persisted.
  setLanguageTransient: (lang: string) => {
    if (!SUPPORTED_LANGUAGE_CODES.includes(lang)) return;
    set((state) => ({ settings: { ...state.settings, language: lang } }));
  },

  updateSettings: async (settingsObj: Partial<Settings>) => {
    const pending = (Object.keys(settingsObj) as SettingsKey[]).map((key) =>
      trackPendingSave(key, readSettingSnapshot(get().settings, key))
    );
    set((state) => ({
      settings: { ...state.settings, ...settingsObj },
    }));
    try {
      await settingsApi.setBulk(settingsObj);
      (Object.keys(settingsObj) as SettingsKey[]).forEach((key, index) => finishPendingSave(key, pending[index]));
    } catch (err: unknown) {
      (Object.keys(settingsObj) as SettingsKey[]).forEach((key, index) => rollbackPendingSave(key, pending[index], set));
      console.error('Failed to save settings:', err);
      throw new Error(getApiErrorMessage(err, 'Error saving settings'));
    }
  },
}));
