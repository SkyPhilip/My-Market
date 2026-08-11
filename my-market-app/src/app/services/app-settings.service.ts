import { Injectable, signal } from '@angular/core';

interface AppSettings {
  pollSeconds: number;
  warnPct: number;
}

const STORAGE_KEY = 'app_settings';

const DEFAULTS: AppSettings = {
  pollSeconds: 30,
  warnPct: 1.5,
};

const BOUNDS = {
  pollSeconds: { min: 10, max: 300 },
  warnPct: { min: 0.1, max: 10 },
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** User-configurable application settings, persisted to localStorage and exposed as signals. */
@Injectable({ providedIn: 'root' })
export class AppSettingsService {
  static readonly BOUNDS = BOUNDS;
  static readonly DEFAULTS = DEFAULTS;

  private readonly _pollSeconds = signal(DEFAULTS.pollSeconds);
  private readonly _warnPct = signal(DEFAULTS.warnPct);

  /** Seconds between background price polls for stop/limit checks. */
  readonly pollSeconds = this._pollSeconds.asReadonly();
  /** Percent-of-level proximity band that triggers the "approaching" warning. */
  readonly warnPct = this._warnPct.asReadonly();

  constructor() {
    this.load();
  }

  setPollSeconds(value: number): void {
    this._pollSeconds.set(clamp(value, BOUNDS.pollSeconds.min, BOUNDS.pollSeconds.max, DEFAULTS.pollSeconds));
    this.persist();
  }

  setWarnPct(value: number): void {
    this._warnPct.set(clamp(value, BOUNDS.warnPct.min, BOUNDS.warnPct.max, DEFAULTS.warnPct));
    this.persist();
  }

  reset(): void {
    this._pollSeconds.set(DEFAULTS.pollSeconds);
    this._warnPct.set(DEFAULTS.warnPct);
    this.persist();
  }

  private load(): void {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      if (typeof parsed.pollSeconds === 'number') {
        this._pollSeconds.set(clamp(parsed.pollSeconds, BOUNDS.pollSeconds.min, BOUNDS.pollSeconds.max, DEFAULTS.pollSeconds));
      }
      if (typeof parsed.warnPct === 'number') {
        this._warnPct.set(clamp(parsed.warnPct, BOUNDS.warnPct.min, BOUNDS.warnPct.max, DEFAULTS.warnPct));
      }
    } catch {
      // ignore malformed settings
    }
  }

  private persist(): void {
    const settings: AppSettings = { pollSeconds: this._pollSeconds(), warnPct: this._warnPct() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
}
