// Local save games (browser storage, guarded).
import { DEFAULT_SETTINGS, Settings } from './app';
import type { Game } from './sim/Game';
import type { GameState } from './sim/state';
import { safeStorage } from './ui/dom';

const PREFIX = 'fairway-empire:';

export interface SaveMeta {
  slot: string;
  club: string;
  day: number;
  money: number;
  chapter: number;
  sandbox: boolean;
  time: number;
}

export function saveGame(game: Game, slot: string): boolean {
  const s = safeStorage();
  if (!s) return false;
  try {
    const data = game.serialize();
    s.setItem(PREFIX + 'save:' + slot, JSON.stringify(data));
    const meta: SaveMeta = { slot, club: data.clubName, day: data.day, money: Math.round(data.money), chapter: data.chapter, sandbox: data.sandbox, time: Date.now() };
    s.setItem(PREFIX + 'meta:' + slot, JSON.stringify(meta));
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

export function loadState(slot: string): GameState | null {
  const s = safeStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(PREFIX + 'save:' + slot);
    if (!raw) return null;
    const st = JSON.parse(raw) as GameState;
    if (!st.world) return null;
    return st;
  } catch {
    return null;
  }
}

export function saveMeta(slot: string): SaveMeta | null {
  const s = safeStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(PREFIX + 'meta:' + slot);
    return raw ? (JSON.parse(raw) as SaveMeta) : null;
  } catch {
    return null;
  }
}

export function deleteSave(slot: string): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.removeItem(PREFIX + 'save:' + slot);
    s.removeItem(PREFIX + 'meta:' + slot);
  } catch {
    /* ignore */
  }
}

export function loadSettings(): Settings {
  const s = safeStorage();
  try {
    const raw = s?.getItem(PREFIX + 'settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  const st = { ...DEFAULT_SETTINGS };
  // modest default on small screens / mobile
  if (window.innerWidth < 900 || /Mobi|Android/i.test(navigator.userAgent)) st.quality = 'medium';
  return st;
}

export function storeSettings(st: Settings): void {
  try {
    safeStorage()?.setItem(PREFIX + 'settings', JSON.stringify(st));
  } catch {
    /* ignore */
  }
}
