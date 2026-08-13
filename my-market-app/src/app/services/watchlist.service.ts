import { Injectable, Signal, WritableSignal, signal } from '@angular/core';

export type WatchlistEntry = string | { symbol: string; costBasis: number; shares?: number };

/**
 * Cross-component access point for watchlists persisted in localStorage under
 * `watchlist_${name}`. Lets any component (dashboard index cards, Money Flow, etc.)
 * add a ticker to a named watchlist and notifies the corresponding WatchlistComponent
 * via a per-name version signal so it can reconcile its rows live.
 */
@Injectable({ providedIn: 'root' })
export class WatchlistService {
  readonly #versions = new Map<string, WritableSignal<number>>();

  #storageKey(name: string): string {
    return `watchlist_${name}`;
  }

  #entrySymbol(entry: WatchlistEntry): string {
    return (typeof entry === 'string' ? entry : entry.symbol).toUpperCase();
  }

  getEntries(name: string): WatchlistEntry[] {
    const raw = localStorage.getItem(this.#storageKey(name));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Upper-cased tickers on a list (deduped), regardless of string/lot entry shape. */
  getSymbols(name: string): string[] {
    return [...new Set(this.getEntries(name).map(entry => this.#entrySymbol(entry)))];
  }

  has(name: string, symbol: string): boolean {
    const upper = symbol.trim().toUpperCase();
    if (!upper) return false;
    return this.getEntries(name).some(entry => this.#entrySymbol(entry) === upper);
  }

  /** Appends a plain-string ticker if absent; returns true if added, false if empty/duplicate. */
  addSymbol(name: string, symbol: string): boolean {
    const upper = symbol.trim().toUpperCase();
    if (!upper || this.has(name, upper)) return false;
    const entries = this.getEntries(name);
    entries.push(upper);
    localStorage.setItem(this.#storageKey(name), JSON.stringify(entries));
    this.#versionSignal(name).update(v => v + 1);
    return true;
  }

  /** Overwrites a watchlist with the given (deduped, upper-cased) tickers and notifies listeners. */
  replaceEntries(name: string, symbols: string[]): void {
    const entries = [...new Set(symbols.map(s => s.trim().toUpperCase()).filter(Boolean))];
    localStorage.setItem(this.#storageKey(name), JSON.stringify(entries));
    this.#versionSignal(name).update(v => v + 1);
  }

  /** Reactive change counter for a watchlist; bumped whenever addSymbol adds a ticker. */
  version(name: string): Signal<number> {
    return this.#versionSignal(name);
  }

  #versionSignal(name: string): WritableSignal<number> {
    let sig = this.#versions.get(name);
    if (!sig) {
      sig = signal(0);
      this.#versions.set(name, sig);
    }
    return sig;
  }
}
