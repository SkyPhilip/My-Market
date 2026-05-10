import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { AlpacaService } from '../../services/alpaca.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="header">
      <div class="header__left">
        <a class="header__brand" (click)="navigateTo('/dashboard')">Forster Market App</a>
        <span class="header__datetime">{{ currentTime() }}</span>
        <span class="header__market-status" [class.open]="marketOpen()" [class.closed]="!marketOpen()">
          {{ marketOpen() ? 'Market Open' : 'Market Closed' }}
        </span>
      </div>
      <nav class="header__nav">
        <a class="header__link" (click)="navigateTo('/dashboard')">Dashboard</a>
        <a class="header__link" (click)="navigateTo('/sectors')">Sectors</a>
        <a class="header__link" (click)="navigateTo('/settings')">Settings</a>
        <button class="header__logout" (click)="onLogout()">Logout</button>
      </nav>
    </header>
  `,
  styles: [`
    .header {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 24px;
      background: #16213e;
      border-bottom: 1px solid #2a3a5e;
    }
    .header__left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .header__brand {
      color: #4a9eff;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
    }
    .header__datetime {
      color: #8892b0;
      font-size: 13px;
      white-space: nowrap;
    }
    .header__market-status {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 12px;
      white-space: nowrap;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .header__market-status.open {
      background: rgba(40, 167, 69, 0.2);
      color: #28a745;
      border: 1px solid rgba(40, 167, 69, 0.4);
    }
    .header__market-status.closed {
      background: rgba(220, 53, 69, 0.2);
      color: #dc3545;
      border: 1px solid rgba(220, 53, 69, 0.4);
    }
    .header__nav {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .header__link {
      color: #a0a0b0;
      cursor: pointer;
      text-decoration: none;
      font-size: 14px;
      transition: color 0.2s;
    }
    .header__link:hover {
      color: #e0e0e0;
    }
    .header__logout {
      background: transparent;
      border: 1px solid #ff6b6b;
      color: #ff6b6b;
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s;
    }
    .header__logout:hover {
      background: #ff6b6b;
      color: #fff;
    }
  `]
})
export class HeaderComponent implements OnInit, OnDestroy {
  private alpacaService = inject(AlpacaService);
  currentTime = signal('');
  marketOpen = signal(false);
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private clockInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private authService: AuthService, private router: Router) {}

  ngOnInit(): void {
    this.updateTime();
    this.timerInterval = setInterval(() => this.updateTime(), 1000);
    this.pollClock();
    this.clockInterval = setInterval(() => this.pollClock(), 60_000);
  }

  ngOnDestroy(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
    }
  }

  private async pollClock(): Promise<void> {
    try {
      const res = await firstValueFrom(this.alpacaService.getClock());
      if (res.body) {
        this.marketOpen.set(res.body.is_open);
      }
    } catch {
      // fall back to local calculation on error
    }
  }

  private updateTime(): void {
    const now = new Date();
    this.currentTime.set(now.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    }) + '  ' + now.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }));
  }

  navigateTo(path: string): void {
    this.router.navigate([path]);
  }

  onLogout(): void {
    this.authService.logout();
  }
}
