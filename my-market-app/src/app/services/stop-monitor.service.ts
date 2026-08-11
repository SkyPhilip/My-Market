import { Injectable, inject, signal, effect } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AlpacaService } from './alpaca.service';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import { AppSettingsService } from './app-settings.service';
import { AlpacaSnapshotsResponse } from '../models/alpaca.models';

export type StopMode = 'trailing' | 'limit';

export interface LotStopConfig {
  mode: StopMode;
  /** Trailing distance below the peak, in percent (trailing mode only). */
  pct: number;
  /** Highest price seen since the stop was set (trailing mode only). */
  peak: number;
  /** Price level that triggers the alert (trailing stop level, or the limit price). */
  stop: number;
  /** Limit mode only: alert when price rises to `stop` (true) or falls to it (false). */
  above: boolean;
  expiry: number;
  /** 'triggered' once the price has crossed the level; stays until dismissed. */
  status: 'active' | 'triggered';
  /** Epoch ms when the alert fired. */
  triggeredAt?: number;
  /** Price that crossed the level. */
  triggerPrice?: number;
  /** Ticker being watched (lets the monitor fetch prices without the component). */
  symbol: string;
  /** Watchlist bucket this lot belongs to (its localStorage key). */
  watchlist: string;
}

const STOP_KEY_PREFIX = 'trailing_stops_';

/**
 * Always-on background monitor for trailing-stop / limit alerts. Root-provided so it keeps
 * polling and firing notifications regardless of the active route (i.e. even off the Dashboard).
 */
@Injectable({ providedIn: 'root' })
export class StopMonitorService {
  private readonly alpaca = inject(AlpacaService);
  private readonly auth = inject(AuthService);
  private readonly notification = inject(NotificationService);
  private readonly settings = inject(AppSettingsService);

  private readonly configs = signal<Map<string, LotStopConfig>>(new Map());
  /** Read-only view of all stop/limit configs, keyed by lotId, for components to render. */
  readonly stops = this.configs.asReadonly();

  /** Lots already toast-warned they're approaching their level (cleared when they leave the band). */
  private readonly nearWarned = new Set<string>();

  /** Cached market-open state; `until` (epoch ms) is the next open/close, when the clock is refetched. */
  private clockCache: { isOpen: boolean; until: number } | null = null;

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.load();
    // Re-arm the poll timer whenever the configured frequency changes.
    effect(() => {
      const ms = this.settings.pollSeconds() * 1000;
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => this.tick(), ms);
    });
    // Kick off shortly after start so a due alert doesn't wait a full interval.
    queueMicrotask(() => this.tick());
  }

  has(lotId: string): boolean {
    return this.configs().has(lotId);
  }

  get(lotId: string): LotStopConfig | undefined {
    return this.configs().get(lotId);
  }

  /** Creates or replaces a lot's config, then persists. */
  set(lotId: string, config: LotStopConfig): void {
    this.configs.update(m => { const next = new Map(m); next.set(lotId, config); return next; });
    this.persist();
  }

  /** Removes a lot's config (and any pending warning), then persists. */
  remove(lotId: string): void {
    if (!this.configs().has(lotId)) return;
    this.configs.update(m => { const next = new Map(m); next.delete(lotId); return next; });
    this.nearWarned.delete(lotId);
    this.persist();
  }

  /** 'up'/'down' when a price is within the warn band of a not-yet-hit level; else null. */
  approachingDirection(config: LotStopConfig, price: number): 'up' | 'down' | null {
    if (config.status === 'triggered' || config.stop <= 0) return null;
    const band = config.stop * (this.settings.warnPct() / 100);
    const up = config.mode === 'limit' && config.above;
    if (up) return price < config.stop && price >= config.stop - band ? 'up' : null;
    return price > config.stop && price <= config.stop + band ? 'down' : null;
  }

  /** Fetches prices for lots with active alerts and evaluates each; skipped until authenticated. */
  private async tick(): Promise<void> {
    if (!this.auth.isAuthenticated()) return;
    const active = [...this.configs()].filter(([, c]) => c.status !== 'triggered');
    if (!active.length) return;
    if (!(await this.isMarketOpen())) return;
    const symbols = [...new Set(active.map(([, c]) => c.symbol))];
    let snapshots: AlpacaSnapshotsResponse | undefined;
    try {
      const res = await firstValueFrom(this.alpaca.getSnapshots(symbols));
      snapshots = res.body ?? undefined;
    } catch {
      return;
    }
    if (!snapshots) return;
    for (const [lotId, config] of active) {
      const snap = snapshots[config.symbol];
      const price = snap?.latestTrade?.p ?? snap?.minuteBar?.c ?? null;
      if (price !== null) this.evaluate(lotId, config, price);
    }
  }

  /** True during the regular session; caches Alpaca's clock so it only refetches at the next open/close. */
  private async isMarketOpen(): Promise<boolean> {
    const now = Date.now();
    if (this.clockCache && now < this.clockCache.until) return this.clockCache.isOpen;
    try {
      const clock = (await firstValueFrom(this.alpaca.getClock())).body;
      if (!clock) return this.clockCache?.isOpen ?? true;
      const until = new Date(clock.is_open ? clock.next_close : clock.next_open).getTime();
      this.clockCache = { isOpen: clock.is_open, until: Number.isFinite(until) ? until : now + 60_000 };
      return clock.is_open;
    } catch {
      // On failure keep the last known state; if none, assume open so alerts aren't silently missed.
      return this.clockCache?.isOpen ?? true;
    }
  }

  /** Ratchets the stop up with new highs; marks it triggered when the price crosses it, or drops it on expiry. */
  private evaluate(lotId: string, config: LotStopConfig, latestPrice: number): void {
    const symbol = config.symbol;
    if (Date.now() >= config.expiry) {
      this.remove(lotId);
      this.notification.showInfo(`${symbol} ${config.mode === 'limit' ? 'limit' : 'trailing stop'} expired.`);
      return;
    }
    if (config.mode === 'limit') {
      const hit = config.above ? latestPrice >= config.stop : latestPrice <= config.stop;
      if (hit) {
        this.markTriggered(lotId, config, config.stop, latestPrice);
        this.notification.showError(`${symbol} hit its limit of $${config.stop.toFixed(2)} (price $${latestPrice.toFixed(2)}).`);
        return;
      }
      const desc = config.above ? `limit target of $${config.stop.toFixed(2)}` : `limit of $${config.stop.toFixed(2)}`;
      this.warnIfNear(lotId, symbol, latestPrice, config.stop, config.above, desc);
      return;
    }
    const peak = Math.max(config.peak, latestPrice);
    const stop = +(peak * (1 - config.pct / 100)).toFixed(4);
    if (latestPrice <= stop) {
      this.markTriggered(lotId, config, stop, latestPrice);
      this.notification.showError(`${symbol} hit its ${config.pct}% trailing stop at $${stop.toFixed(2)} (price $${latestPrice.toFixed(2)}).`);
      return;
    }
    this.warnIfNear(lotId, symbol, latestPrice, stop, false, `${config.pct}% trailing stop ($${stop.toFixed(2)})`);
    if (peak !== config.peak || stop !== config.stop) {
      this.set(lotId, { ...config, peak, stop });
    }
  }

  /** Toasts once when a price first enters the warn band of its level; re-arms when it leaves. */
  private warnIfNear(lotId: string, symbol: string, price: number, level: number, up: boolean, desc: string): void {
    if (level <= 0) return;
    const band = level * (this.settings.warnPct() / 100);
    const near = up ? (price < level && price >= level - band) : (price > level && price <= level + band);
    if (near && !this.nearWarned.has(lotId)) {
      this.nearWarned.add(lotId);
      this.notification.showInfo(`${symbol} nearing its ${desc} — price $${price.toFixed(2)}.`);
    } else if (!near) {
      this.nearWarned.delete(lotId);
    }
  }

  private markTriggered(lotId: string, config: LotStopConfig, stop: number, triggerPrice: number): void {
    this.nearWarned.delete(lotId);
    this.set(lotId, { ...config, stop, status: 'triggered', triggeredAt: Date.now(), triggerPrice });
  }

  /** Restores every `trailing_stops_*` bucket, backfilling symbols and dropping expired non-triggered lots. */
  private load(): void {
    const now = Date.now();
    const map = new Map<string, LotStopConfig>();
    for (const [watchlist, raw] of this.stopBuckets()) {
      let parsed: Record<string, Partial<LotStopConfig>>;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const symbolByLot = this.symbolMap(watchlist);
      for (const [lotId, cfg] of Object.entries(parsed)) {
        const triggered = cfg?.status === 'triggered';
        if (!cfg || typeof cfg.stop !== 'number' || typeof cfg.expiry !== 'number') continue;
        if (!triggered && cfg.expiry <= now) continue;
        const symbol = (typeof cfg.symbol === 'string' && cfg.symbol) || symbolByLot.get(lotId);
        if (!symbol) continue;
        map.set(lotId, {
          mode: cfg.mode === 'limit' ? 'limit' : 'trailing',
          pct: typeof cfg.pct === 'number' ? cfg.pct : 0,
          peak: typeof cfg.peak === 'number' ? cfg.peak : cfg.stop,
          stop: cfg.stop,
          above: cfg.above === true,
          expiry: cfg.expiry,
          status: triggered ? 'triggered' : 'active',
          triggeredAt: typeof cfg.triggeredAt === 'number' ? cfg.triggeredAt : undefined,
          triggerPrice: typeof cfg.triggerPrice === 'number' ? cfg.triggerPrice : undefined,
          symbol,
          watchlist,
        });
      }
    }
    this.configs.set(map);
    this.persist();
  }

  /** All `trailing_stops_*` localStorage entries as [watchlistName, rawJson]. */
  private stopBuckets(): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STOP_KEY_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (raw) out.push([key.slice(STOP_KEY_PREFIX.length), raw]);
    }
    return out;
  }

  /** lotId → symbol for a watchlist, read from its `watchlist_*` entries (for legacy configs lacking a symbol). */
  private symbolMap(watchlist: string): Map<string, string> {
    const out = new Map<string, string>();
    const raw = localStorage.getItem(`watchlist_${watchlist}`);
    if (!raw) return out;
    try {
      const entries = JSON.parse(raw);
      if (Array.isArray(entries)) {
        for (const e of entries) {
          if (e && typeof e === 'object' && typeof e.lotId === 'string' && typeof e.symbol === 'string') {
            out.set(e.lotId, e.symbol);
          }
        }
      }
    } catch {
      // ignore malformed watchlist storage
    }
    return out;
  }

  /** Writes each watchlist's configs back to its bucket; emptied buckets are cleared to `{}`. */
  private persist(): void {
    const buckets = new Map<string, Record<string, LotStopConfig>>();
    for (const [lotId, cfg] of this.configs()) {
      const bucket = buckets.get(cfg.watchlist) ?? {};
      bucket[lotId] = cfg;
      buckets.set(cfg.watchlist, bucket);
    }
    const watchlists = new Set<string>(buckets.keys());
    for (const [watchlist] of this.stopBuckets()) watchlists.add(watchlist);
    for (const watchlist of watchlists) {
      localStorage.setItem(`${STOP_KEY_PREFIX}${watchlist}`, JSON.stringify(buckets.get(watchlist) ?? {}));
    }
  }
}
