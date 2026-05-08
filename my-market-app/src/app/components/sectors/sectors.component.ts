import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AccordionGroup, AccordionTrigger, AccordionPanel, AccordionContent } from '@angular/aria/accordion';
import { firstValueFrom } from 'rxjs';
import { AlpacaService } from '../../services/alpaca.service';
import { AlpacaSnapshot } from '../../models/alpaca.models';
import { SECTOR_SYMBOLS } from '../../data/sector-symbols';

interface SectorStock {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number;
}

interface SectorData {
  stocks: SectorStock[];
  totalVolume: number;
  loading: boolean;
  error: boolean;
  loaded: boolean;
}

@Component({
  selector: 'app-sectors',
  standalone: true,
  imports: [CommonModule, AccordionGroup, AccordionTrigger, AccordionPanel, AccordionContent],
  template: `
    <div class="sectors-page">
      <h2>Sectors</h2>
      @if (loadingSectors()) {
        <p class="loading">Loading sectors...</p>
      } @else if (sectors().length) {
        <div ngAccordionGroup [multiExpandable]="true" [wrap]="true" class="accordion">
          @for (sector of sectors(); track sector) {
            <div class="accordion-item">
              <h3>
                <button ngAccordionTrigger [panel]="panel" (expandedChange)="onExpandedChange(sector, $event)" class="accordion-trigger">
                  <span class="accordion-title">
                    @if (sectorData().get(sector)?.loaded) {
                      {{ formatVolume(sectorData().get(sector)?.totalVolume ?? 0) }} — {{ sector }}
                    } @else if (sectorData().get(sector)?.loading) {
                      {{ sector }} …
                    } @else {
                      {{ sector }}
                    }
                  </span>
                  @if (sectorData().get(sector)?.loaded) {
                    <span class="accordion-count">
                      ({{ sectorData().get(sector)?.stocks?.length ?? 0 }})
                    </span>
                  }
                  <span class="accordion-icon">▸</span>
                </button>
              </h3>
              <div ngAccordionPanel #panel="ngAccordionPanel" class="accordion-panel">
                <ng-template ngAccordionContent>
                  @if (sectorData().get(sector)?.loading) {
                    <p class="loading">Loading top securities...</p>
                  } @else if (sectorData().get(sector)?.error) {
                    <p class="loading">Failed to load. <button class="retry-btn" (click)="loadSector(sector)">Retry</button></p>
                  } @else if (sectorData().get(sector)?.stocks?.length) {
                    <table class="sector-table">
                      <thead>
                        <tr>
                          <th>Symbol</th>
                          <th class="right">Price</th>
                          <th class="right">Change</th>
                          <th class="right">Change %</th>
                          <th class="right">Volume</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (stock of sectorData().get(sector)!.stocks; track stock.symbol) {
                          <tr>
                            <td class="symbol">{{ stock.symbol }}</td>
                            <td class="right">{{ stock.price !== null ? ('$' + (stock.price | number:'1.2-2')) : '—' }}</td>
                            <td class="right" [class.positive]="(stock.change ?? 0) >= 0" [class.negative]="(stock.change ?? 0) < 0">
                              {{ stock.change !== null ? ((stock.change >= 0 ? '+' : '') + (stock.change | number:'1.2-2')) : '—' }}
                            </td>
                            <td class="right" [class.positive]="(stock.changePercent ?? 0) >= 0" [class.negative]="(stock.changePercent ?? 0) < 0">
                              {{ stock.changePercent !== null ? ((stock.changePercent >= 0 ? '+' : '') + (stock.changePercent | number:'1.2-2') + '%') : '—' }}
                            </td>
                            <td class="right">{{ stock.volume | number:'1.0-0' }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  } @else {
                    <p class="loading">No securities found.</p>
                  }
                </ng-template>
              </div>
            </div>
          }
        </div>
      } @else {
        <p class="loading">No sectors available.</p>
      }
    </div>
  `,
  styles: [`
    .sectors-page {
      padding: 24px;
    }
    h2 {
      color: #e0e0e0;
      margin: 0 0 20px;
      font-size: 22px;
    }
    .loading {
      color: #8892b0;
      font-size: 14px;
    }
    .accordion {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .accordion-item {
      border: 1px solid #2a3a5e;
      border-radius: 8px;
      overflow: hidden;
    }
    .accordion-trigger {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 14px 20px;
      background: #16213e;
      border: none;
      color: #e0e0e0;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
      transition: background 0.2s;
    }
    .accordion-trigger:hover {
      background: #1a2744;
    }
    .accordion-trigger[aria-expanded="true"] {
      background: #1a2744;
      border-bottom: 1px solid #2a3a5e;
    }
    .accordion-trigger[aria-expanded="true"] .accordion-icon {
      transform: rotate(90deg);
    }
    .accordion-title {
      flex: 1;
    }
    .accordion-count {
      color: #8892b0;
      font-size: 13px;
      font-weight: 400;
    }
    .accordion-icon {
      color: #4a9eff;
      font-size: 12px;
      transition: transform 0.2s;
    }
    .accordion-panel {
      background: #0f1a30;
      padding: 0;
    }
    .accordion-panel[aria-hidden="true"] {
      display: none;
    }
    .sector-table {
      width: 100%;
      border-collapse: collapse;
    }
    .sector-table th {
      text-align: left;
      padding: 10px 16px;
      color: #8892b0;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #2a3a5e;
    }
    .sector-table th.right {
      text-align: right;
    }
    .sector-table td {
      padding: 10px 16px;
      color: #e0e0e0;
      font-size: 13px;
      border-bottom: 1px solid #1a2744;
    }
    .sector-table tr:last-child td {
      border-bottom: none;
    }
    .sector-table .symbol {
      font-weight: 600;
      color: #4a9eff;
    }
    .sector-table .right {
      text-align: right;
    }
    .sector-table .positive {
      color: #28a745;
    }
    .sector-table .negative {
      color: #dc3545;
    }
    .retry-btn {
      background: #4a9eff;
      border: none;
      color: #fff;
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
  `]
})
export class SectorsComponent implements OnInit {
  private alpacaService = inject(AlpacaService);

  sectors = signal<string[]>([]);
  loadingSectors = signal(true);
  sectorData = signal<Map<string, SectorData>>(new Map());

  async ngOnInit(): Promise<void> {
    try {
      const sectorNames = Object.keys(SECTOR_SYMBOLS);
      this.sectors.set(sectorNames);
      await Promise.all(sectorNames.map(sector => this.loadSector(sector)));
      this.#sortSectorsByVolume();
    } catch {
      this.sectors.set([]);
    } finally {
      this.loadingSectors.set(false);
    }
  }

  onExpandedChange(sector: string, expanded: boolean): void {
    if (expanded && !this.sectorData().get(sector)?.loaded) {
      this.loadSector(sector);
    }
  }

  async loadSector(sector: string): Promise<void> {
    this.sectorData.update(map => {
      const updated = new Map(map);
      updated.set(sector, { stocks: [], totalVolume: 0, loading: true, error: false, loaded: false });
      return updated;
    });

    try {
      const symbols = SECTOR_SYMBOLS[sector] ?? [];
      const result = await firstValueFrom(this.alpacaService.getSnapshots(symbols));
      const snapshots = result?.body ?? {};

      const stocks: SectorStock[] = symbols
        .map(symbol => {
          const snap: AlpacaSnapshot | undefined = snapshots[symbol];
          if (!snap) return { symbol, price: null, change: null, changePercent: null, volume: 0 };
          const price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? null;
          const prevClose = snap.prevDailyBar?.c ?? null;
          const change = price && prevClose ? +(price - prevClose).toFixed(2) : null;
          const changePercent = price && prevClose ? +((change! / prevClose) * 100).toFixed(2) : null;
          const volume = snap.dailyBar?.v ?? 0;
          return { symbol, price, change, changePercent, volume };
        })
        .sort((a, b) => b.volume - a.volume);

      const totalVolume = stocks.reduce((sum, s) => sum + s.volume, 0);

      this.sectorData.update(map => {
        const updated = new Map(map);
        updated.set(sector, { stocks, totalVolume, loading: false, error: false, loaded: true });
        return updated;
      });
    } catch {
      this.sectorData.update(map => {
        const updated = new Map(map);
        updated.set(sector, { stocks: [], totalVolume: 0, loading: false, error: true, loaded: false });
        return updated;
      });
    }
  }

  formatVolume(value: number): string {
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
    return value.toLocaleString();
  }

  #sortSectorsByVolume(): void {
    const data = this.sectorData();
    this.sectors.update(sectors =>
      [...sectors].sort((a, b) => (data.get(b)?.totalVolume ?? 0) - (data.get(a)?.totalVolume ?? 0))
    );
  }
}
