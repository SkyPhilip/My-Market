import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const credentials = authService.getCredentials();

  if (credentials && req.url.includes('alpaca.markets')) {
    const cloned = req.clone({
      setHeaders: {
        'APCA-API-KEY-ID': credentials.keyId,
        'APCA-API-SECRET-KEY': credentials.secretKey
      }
    });
    return next(cloned);
  }

  return next(req);
};
