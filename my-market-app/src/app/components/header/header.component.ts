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
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
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
