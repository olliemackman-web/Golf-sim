// Shared application interface (implemented in main.ts).
import type { Quality } from './render/Renderer';
import type { View } from './render/View';
import type { Game } from './sim/Game';
import type { Tools } from './ui/Tools';

export interface Settings {
  quality: Quality;
  master: number;
  sfx: number;
  ambience: number;
  music: number;
  musicOn: boolean;
  autosave: boolean;
  tips: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  master: 0.8,
  sfx: 0.9,
  ambience: 0.7,
  music: 0.45,
  musicOn: true,
  autosave: true,
  tips: true,
};

export type PlayConfig =
  | { mode: 'range'; bayId?: number; challenge: 'free' | 'longdrive' | 'target' | 'closest' }
  | { mode: 'course'; holes: number[]; tournament?: boolean };

export interface AppApi {
  game: Game;
  view: View;
  tools: Tools;
  settings: Settings;
  saveGame(slot: string): boolean;
  loadSlot(slot: string): void;
  quitToMenu(): void;
  startPlay(cfg: PlayConfig): void;
  applySettings(): void;
  sfx(name: string, opts?: { volume?: number; pitch?: number; pan?: number }): void;
}
