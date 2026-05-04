import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-container">
      <div class="login-card">
        <h1>My Market App</h1>
        <p class="subtitle">Enter your Alpaca API credentials to continue</p>

        <form (ngSubmit)="onSubmit()" #loginForm="ngForm">
          <div class="form-group">
            <label for="keyId">API Key</label>
            <input
              id="keyId"
              type="text"
              [(ngModel)]="keyId"
              name="keyId"
              required
              placeholder="Your Alpaca API Key"
              [disabled]="loading"
            />
          </div>

          <div class="form-group">
            <label for="secretKey">API Secret</label>
            <input
              id="secretKey"
              type="password"
              [(ngModel)]="secretKey"
              name="secretKey"
              required
              placeholder="Your Alpaca Secret Key"
              [disabled]="loading"
            />
          </div>

          @if (errorMessage) {
            <div class="error-message">{{ errorMessage }}</div>
          }

          <button type="submit" [disabled]="loading || !keyId || !secretKey">
            {{ loading ? 'Connecting...' : 'Log In' }}
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .login-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #1a1a2e;
    }
    .login-card {
      background: #16213e;
      border-radius: 12px;
      padding: 40px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }
    h1 {
      color: #e0e0e0;
      margin: 0 0 8px;
      font-size: 28px;
    }
    .subtitle {
      color: #8892b0;
      margin: 0 0 24px;
      font-size: 14px;
    }
    .form-group {
      margin-bottom: 16px;
    }
    label {
      display: block;
      color: #a0a0b0;
      font-size: 13px;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #2a3a5e;
      border-radius: 6px;
      background: #0f3460;
      color: #e0e0e0;
      font-size: 14px;
      box-sizing: border-box;
    }
    input:focus {
      outline: none;
      border-color: #4a9eff;
    }
    input:disabled {
      opacity: 0.6;
    }
    .error-message {
      color: #ff6b6b;
      background: rgba(255, 107, 107, 0.1);
      border: 1px solid rgba(255, 107, 107, 0.3);
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 16px;
      font-size: 13px;
    }
    button {
      width: 100%;
      padding: 12px;
      background: #4a9eff;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 15px;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover:not(:disabled) {
      background: #3a8eef;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `]
})
export class LoginComponent {
  keyId = '';
  secretKey = '';
  loading = false;
  errorMessage = '';

  constructor(private authService: AuthService, private router: Router, private cdr: ChangeDetectorRef) {}

  onSubmit(): void {
    this.loading = true;
    this.errorMessage = '';

    this.authService.login(this.keyId, this.secretKey).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.loading = false;
        if (err.status === 401) {
          this.errorMessage = 'Invalid API Key or Secret. Please check your credentials and try again.';
        } else {
          this.errorMessage = err.error?.error || 'Unable to connect. Please try again later.';
        }
        this.cdr.detectChanges();
      }
    });
  }
}
