import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _isAuthenticated = signal(this.hasStoredCredentials());
  readonly isAuthenticated = this._isAuthenticated.asReadonly();

  constructor(private http: HttpClient, private router: Router) {}

  private hasStoredCredentials(): boolean {
    return !!sessionStorage.getItem('alpaca_key_id') && !!sessionStorage.getItem('alpaca_secret_key');
  }

  getCredentials(): { keyId: string; secretKey: string } | null {
    const keyId = sessionStorage.getItem('alpaca_key_id');
    const secretKey = sessionStorage.getItem('alpaca_secret_key');
    if (keyId && secretKey) {
      return { keyId, secretKey };
    }
    return null;
  }

  login(keyId: string, secretKey: string): Observable<any> {
    console.log('AuthService: attempting login...');
    return this.http.get('https://paper-api.alpaca.markets/v2/account', {
      headers: {
        'APCA-API-KEY-ID': keyId,
        'APCA-API-SECRET-KEY': secretKey
      }
    }).pipe(
      tap((response) => {
        console.log('AuthService: login successful', response);
        sessionStorage.setItem('alpaca_key_id', keyId);
        sessionStorage.setItem('alpaca_secret_key', secretKey);
        this._isAuthenticated.set(true);
      }),
      catchError((err) => {
        console.error('AuthService: login failed', err);
        return throwError(() => err);
      })
    );
  }

  logout(): void {
    sessionStorage.removeItem('alpaca_key_id');
    sessionStorage.removeItem('alpaca_secret_key');
    this._isAuthenticated.set(false);
    this.router.navigate(['/login']);
  }
}
