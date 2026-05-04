import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
  isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  constructor(private http: HttpClient, private router: Router) {}

  get isAuthenticated(): boolean {
    return this.isAuthenticatedSubject.value;
  }

  login(keyId: string, secretKey: string): Observable<any> {
    console.log('AuthService: attempting login...');
    return this.http.post('/api/login', { keyId, secretKey }).pipe(
      tap((response) => {
        console.log('AuthService: login successful', response);
        this.isAuthenticatedSubject.next(true);
      })
    );
  }

  logout(): Observable<any> {
    return this.http.post('/api/logout', {}).pipe(
      tap(() => {
        this.isAuthenticatedSubject.next(false);
        this.router.navigate(['/login']);
      })
    );
  }

  setAuthenticated(value: boolean): void {
    this.isAuthenticatedSubject.next(value);
  }
}
