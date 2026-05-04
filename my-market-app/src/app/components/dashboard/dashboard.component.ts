import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlpacaService } from '../../services/alpaca.service';
import { ChartComponent } from '../chart/chart.component';
import { LineData, Time } from 'lightweight-charts';

interface IndexCard {
  symbol: string;
  name: string;
  currentPrice: number | null;
  change: number | null;
  changePercent: number | null;
  chartData: LineData<Time>[];
  color: string;
  loaded: boolean;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ChartComponent],
  template: `
    <div class="dashboard">
      <h2>Market Overview</h2>
      <div class="index-cards">
        @for (card of indices; track card.symbol) {
          <div class="index-card">
            <div class="index-card__header">
              <span class="index-card__name">{{ card.name }}</span>
              <span class="index-card__symbol">{{ card.symbol }}</span>
            </div>
            <div class="index-card__price">
              @if (card.currentPrice !== null) {
                <span class="price">{{'$'}}{{ card.currentPrice | number:'1.2-2' }}</span>
                @if (card.change !== null) {
                  <span class="change" [class.positive]="card.change >= 0" [class.negative]="card.change < 0">
                    {{ card.change >= 0 ? '+' : '' }}{{ card.change | number:'1.2-2' }}
                    ({{ card.changePercent! >= 0 ? '+' : '' }}{{ card.changePercent | number:'1.2-2' }}%)
                  </span>
                }
              } @else if (card.loaded) {
                <span class="loading">No data available</span>
              } @else {
                <span class="loading">Loading...</span>
              }
            </div>
            <app-chart [data]="card.chartData" [color]="card.color"></app-chart>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .dashboard {
      padding: 24px;
    }
    h2 {
      color: #e0e0e0;
      margin: 0 0 20px;
      font-size: 22px;
    }
    .index-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 20px;
    }
    .index-card {
      background: #16213e;
      border-radius: 10px;
      padding: 20px;
      border: 1px solid #2a3a5e;
    }
    .index-card__header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .index-card__name {
      color: #e0e0e0;
      font-size: 16px;
      font-weight: 600;
    }
    .index-card__symbol {
      color: #8892b0;
      font-size: 13px;
    }
    .index-card__price {
      margin-bottom: 12px;
    }
    .price {
      color: #e0e0e0;
      font-size: 24px;
      font-weight: 700;
      margin-right: 12px;
    }
    .change {
      font-size: 14px;
    }
    .change.positive {
      color: #28a745;
    }
    .change.negative {
      color: #dc3545;
    }
    .loading {
      color: #8892b0;
      font-size: 14px;
    }
  `]
})
export class DashboardComponent implements OnInit {
  indices: IndexCard[] = [
    { symbol: 'DIA', name: 'Dow Jones', currentPrice: null, change: null, changePercent: null, chartData: [], color: '#4a9eff', loaded: false },
    { symbol: 'SPY', name: 'S&P 500', currentPrice: null, change: null, changePercent: null, chartData: [], color: '#28a745', loaded: false },
    { symbol: 'QQQ', name: 'Nasdaq', currentPrice: null, change: null, changePercent: null, chartData: [], color: '#ffc107', loaded: false }
  ];

  constructor(private alpacaService: AlpacaService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadMarketSummary();
    this.loadCharts();
  }

  private loadMarketSummary(): void {
    this.alpacaService.getMarketSummary().subscribe({
      next: (summary) => {
        console.log('Market summary received:', summary);
        summary.forEach(item => {
          const card = this.indices.find(i => i.symbol === item.symbol);
          if (card) {
            card.currentPrice = item.currentPrice;
            card.change = item.change;
            card.changePercent = item.changePercent;
            card.loaded = true;
          }
        });
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Market summary error:', err);
        this.indices.forEach(c => c.loaded = true);
        this.cdr.detectChanges();
      }
    });
  }

  private loadCharts(): void {
    const today = new Date().toISOString().split('T')[0];
    this.indices.forEach(card => {
      this.alpacaService.getBars(card.symbol, '5Min', today, today).subscribe({
        next: (bars) => {
          console.log(`Bars received for ${card.symbol}:`, bars.length);
          card.chartData = bars.map(bar => ({
            time: Math.floor(new Date(bar.time).getTime() / 1000) as Time,
            value: bar.close
          }));
          // Use last bar close as fallback price if snapshot didn't provide one
          if (card.currentPrice === null && bars.length > 0) {
            card.currentPrice = bars[bars.length - 1].close;
            card.loaded = true;
          }
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.error(`Bars error for ${card.symbol}:`, err);
        }
      });
    });
  }
}
