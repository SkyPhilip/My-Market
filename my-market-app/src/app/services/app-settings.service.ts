import { Injectable, signal } from '@angular/core';
import { MA_PERIODS } from '../utils/moving-averages';

interface AppSettings {
  pollSeconds: number;
  warnPct: number;
  movingAveragePeriods: number[];
}

const STORAGE_KEY = 'app_settings';

const DEFAULTS: AppSettings = {
  pollSeconds: 30,
  warnPct: 1.5,
  movingAveragePeriods: [20, 50, 200],
};

const BOUNDS = {
  pollSeconds: { min: 10, max: 300 },
  warnPct: { min: 0.1, max: 10 },
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Dedupes/filters to the known MA_PERIODS and sorts ascending; falls back to the default set if empty. */
function sanitizeMaPeriods(periods: unknown): number[] {
  if (!Array.isArray(periods)) return DEFAULTS.movingAveragePeriods;
  const valid = [...new Set(periods.filter((p): p is number => MA_PERIODS.includes(p)))].sort((a, b) => a - b);
  return valid.length ? valid : DEFAULTS.movingAveragePeriods;
}

/** User-configurable application settings, persisted to localStorage and exposed as signals. */
@Injectable({ providedIn: 'root' })
export class AppSettingsService {
  static readonly BOUNDS = BOUNDS;
  static readonly DEFAULTS = DEFAULTS;
  static readonly MA_PERIODS = MA_PERIODS;

  private readonly _pollSeconds = signal(DEFAULTS.pollSeconds);
  private readonly _warnPct = signal(DEFAULTS.warnPct);
  private readonly _movingAveragePeriods = signal(DEFAULTS.movingAveragePeriods);

  /** Seconds between background price polls for stop/limit checks. */
  readonly pollSeconds = this._pollSeconds.asReadonly();
  /** Percent-of-level proximity band that triggers the "approaching" warning. */
  readonly warnPct = this._warnPct.asReadonly();
  /** Which SMA periods get a toggle button on every chart (watchlist + index charts). */
  readonly movingAveragePeriods = this._movingAveragePeriods.asReadonly();

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

  toggleMovingAveragePeriod(period: number): void {
    if (!(MA_PERIODS as readonly number[]).includes(period)) return;
    const current = this._movingAveragePeriods();
    const next = current.includes(period) ? current.filter(p => p !== period) : [...current, period].sort((a, b) => a - b);
    this._movingAveragePeriods.set(next);
    this.persist();
  }

  reset(): void {
    this._pollSeconds.set(DEFAULTS.pollSeconds);
    this._warnPct.set(DEFAULTS.warnPct);
    this._movingAveragePeriods.set(DEFAULTS.movingAveragePeriods);
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
      if (parsed.movingAveragePeriods !== undefined) {
        this._movingAveragePeriods.set(sanitizeMaPeriods(parsed.movingAveragePeriods));
      }
    } catch {
      // ignore malformed settings
    }
  }

  private persist(): void {
    const settings: AppSettings = { pollSeconds: this._pollSeconds(), warnPct: this._warnPct(), movingAveragePeriods: this._movingAveragePeriods() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
}

