import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, catchError, throwError } from 'rxjs';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private isAuthenticatedSubject = new BehaviorSubject<boolean>(this.hasStoredCredentials());
  isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  constructor(private http: HttpClient, private router: Router) {}

  get isAuthenticated(): boolean {
    return this.isAuthenticatedSubject.value;
  }

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
    // Validate credentials by calling Alpaca account endpoint directly
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
        this.isAuthenticatedSubject.next(true);
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
    this.isAuthenticatedSubject.next(false);
    this.router.navigate(['/login']);
  }

  setAuthenticated(value: boolean): void {
    this.isAuthenticatedSubject.next(value);
  }
}
