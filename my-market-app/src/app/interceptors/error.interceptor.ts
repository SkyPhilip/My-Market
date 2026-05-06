import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';
import { AuthService } from '../services/auth.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notificationService = inject(NotificationService);
  const authService = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError(error => {
      console.log('ErrorInterceptor caught:', req.url, 'status:', error.status, 'body:', error.error);
      const isLoginRequest = req.url.includes('/v2/account') && !authService.isAuthenticated;

      if (error.status === 401 && !isLoginRequest) {
        console.log('ErrorInterceptor: credentials invalid, redirecting to login');
        authService.logout();
      } else if (!isLoginRequest) {
        const message = error.error?.message || 'An unexpected error occurred. Please try again.';
        console.log('ErrorInterceptor: showing notification:', message);
        notificationService.showError(message);
      }

      return throwError(() => error);
    })
  );
};
