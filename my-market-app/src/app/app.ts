import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HeaderComponent } from './components/header/header.component';
import { NotificationComponent } from './components/notification/notification.component';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, HeaderComponent, NotificationComponent],
  template: `
    <app-notification></app-notification>
    @if (authService.isAuthenticated$ | async) {
      <app-header></app-header>
    }
    <router-outlet></router-outlet>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background: #1a1a2e;
    }
  `]
})
export class App {
  constructor(public authService: AuthService) {}
}
