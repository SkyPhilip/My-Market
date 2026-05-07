import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="header">
      <div class="header__left">
        <a class="header__brand" (click)="navigateTo('/dashboard')">Forster Market App</a>
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
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 24px;
      background: #16213e;
      border-bottom: 1px solid #2a3a5e;
    }
    .header__brand {
      color: #4a9eff;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
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
export class HeaderComponent {
  constructor(private authService: AuthService, private router: Router) {}

  navigateTo(path: string): void {
    this.router.navigate([path]);
  }

  onLogout(): void {
    this.authService.logout();
  }
}
