import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlpacaService } from '../../services/alpaca.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="settings">
      <h2>Alpaca Account Settings</h2>
      @if (account()) {
        <div class="settings-grid">
          <div class="setting-item">
            <span class="label">Account Status</span>
            <span class="value" [class.active]="account().status === 'ACTIVE'">{{ account().status }}</span>
          </div>
          <div class="setting-item">
            <span class="label">Account Number</span>
            <span class="value">{{ account().account_number }}</span>
          </div>
          <div class="setting-item">
            <span class="label">Equity</span>
            <span class="value">\${{ account().equity | number:'1.2-2' }}</span>
          </div>
          <div class="setting-item">
            <span class="label">Buying Power</span>
            <span class="value">\${{ account().buying_power | number:'1.2-2' }}</span>
          </div>
          <div class="setting-item">
            <span class="label">Cash</span>
            <span class="value">\${{ account().cash | number:'1.2-2' }}</span>
          </div>
          <div class="setting-item">
            <span class="label">Portfolio Value</span>
            <span class="value">\${{ account().portfolio_value | number:'1.2-2' }}</span>
          </div>
          <div class="setting-item">
            <span class="label">Day Trade Count</span>
            <span class="value">{{ account().daytrade_count }}</span>
          </div>
          <div class="setting-item">
            <span class="label">Pattern Day Trader</span>
            <span class="value">{{ account().pattern_day_trader ? 'Yes' : 'No' }}</span>
          </div>
          <div class="setting-item">
            <span class="label">Trading Blocked</span>
            <span class="value">{{ account().trading_blocked ? 'Yes' : 'No' }}</span>
          </div>
          <div class="setting-item">
            <span class="label">Account Type</span>
            <span class="value">Paper Trading</span>
          </div>
        </div>
      } @else {
        <p class="loading">Loading account information...</p>
      }
    </div>
  `,
  styles: [`
    .settings {
      padding: 24px;
    }
    h2 {
      color: #e0e0e0;
      margin: 0 0 24px;
      font-size: 22px;
    }
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .setting-item {
      background: #16213e;
      border: 1px solid #2a3a5e;
      border-radius: 8px;
      padding: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .label {
      color: #8892b0;
      font-size: 14px;
    }
    .value {
      color: #e0e0e0;
      font-size: 15px;
      font-weight: 500;
    }
    .value.active {
      color: #28a745;
    }
    .loading {
      color: #8892b0;
    }
  `]
})
export class SettingsComponent implements OnInit {
  private alpacaService = inject(AlpacaService);
  readonly account = signal<any>(null);

  ngOnInit(): void {
    this.alpacaService.getAccount().subscribe({
      next: (data) => {
        console.log('Settings: account data received:', data);
        this.account.set(data);
      },
      error: (err) => {
        console.error('Settings: account error:', err);
      }
    });
  }
}
