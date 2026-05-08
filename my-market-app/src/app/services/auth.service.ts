import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Router } from '@angular/router';
import { AlpacaAccount } from '../models/alpaca.models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  static readonly SESSION_KEY = 'alpaca_credentials';

  #credentials: { keyId: string; secretKey: string } | null = null;
  private readonly _isAuthenticated = signal<boolean>(false);
  readonly isAuthenticated = this._isAuthenticated.asReadonly();

  constructor(private http: HttpClient, private router: Router) {
    this.#restoreSession();
  }

  #restoreSession(): void {
    try {
      const stored = sessionStorage.getItem(AuthService.SESSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.keyId && parsed?.secretKey) {
          this.#credentials = { keyId: parsed.keyId, secretKey: parsed.secretKey };
          this._isAuthenticated.set(true);
        }
      }
    } catch {
      sessionStorage.removeItem(AuthService.SESSION_KEY);
    }
  }

  getCredentials(): { keyId: string; secretKey: string } | null {
    return this.#credentials;
  }

  login(keyId: string, secretKey: string): Observable<HttpResponse<AlpacaAccount>> {
    return this.http.get<AlpacaAccount>('https://paper-api.alpaca.markets/v2/account', {
      observe: 'response',
      headers: {
        'APCA-API-KEY-ID': keyId,
        'APCA-API-SECRET-KEY': secretKey
      }
    });
  }

  storeCredentials(keyId: string, secretKey: string): void {
    this.#credentials = { keyId, secretKey };
    this._isAuthenticated.set(true);
    sessionStorage.setItem(AuthService.SESSION_KEY, JSON.stringify({ keyId, secretKey }));
  }

  logout(): void {
    this.#credentials = null;
    this._isAuthenticated.set(false);
    sessionStorage.clear();
    this.router.navigate(['/login']);
  }
}
