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
      // Don't show toast for login 401s — handled inline by LoginComponent
      const isLoginRequest = req.url.includes('/api/login');

      if (error.status === 401 && !isLoginRequest) {
        authService.setAuthenticated(false);
        router.navigate(['/login']);
      } else if (!isLoginRequest) {
        const message = error.error?.error || 'An unexpected error occurred. Please try again.';
        notificationService.showError(message);
      }

      return throwError(() => error);
    })
  );
};
