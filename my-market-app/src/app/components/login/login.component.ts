import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpResponse } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { fetchFnWithState } from '../../utils/fetch-rx';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
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
              [disabled]="fetchState().prefetchOrBusy && !fetchState().nascent"
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
              [disabled]="fetchState().prefetchOrBusy && !fetchState().nascent"
            />
          </div>

          @if (fetchState().errorRes; as errorRes) {
            <div class="error-message">
              @if (errorRes.status === 401 || errorRes.status === 403) {
                Invalid API Key or Secret. Please check your credentials and try again.
              } @else {
                Unable to connect. Please try again later.
              }
            </div>
          }

          @if (fetchState().exception) {
            <div class="error-message">Unable to connect. Please try again later.</div>
          }

          <button type="submit" [disabled]="(fetchState().prefetchOrBusy && !fetchState().nascent) || !keyId || !secretKey">
            {{ (fetchState().prefetchOrBusy && !fetchState().nascent) ? 'Connecting...' : 'Log In' }}
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

  private authService = inject(AuthService);
  private router = inject(Router);

  fetch = fetchFnWithState<any, any, { keyId: string; secretKey: string }>((credentials) =>
    this.authService.login(credentials.keyId, credentials.secretKey)
  );

  fetchState = computed(() => {
    const { nascent, prefetchOrBusy, okRes, errorRes, errorResOrException, busy, exception } = this.fetch.state();
    return {
      nascent,
      prefetchOrBusy,
      busy,
      okRes,
      errorRes: errorRes as HttpResponse<any> | undefined,
      errorResOrException,
      exception,
    };
  });

  async onSubmit(): Promise<void> {
    const result = await this.fetch({ keyId: this.keyId, secretKey: this.secretKey });
    if (result.okRes) {
      this.authService.storeCredentials(this.keyId, this.secretKey);
      this.router.navigate(['/dashboard']);
    }
  }
}
