import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';
import { AuthService } from '../services/auth.service';

function getApiSource(url: string): string {
  try {
    const host = new URL(url).host.toLowerCase();
    if (host.includes('data.alpaca.markets')) return 'Alpaca Data API';
    if (host.includes('paper-api.alpaca.markets')) return 'Alpaca Trading API';
    if (host.includes('financialmodelingprep.com')) return 'FMP API';
    if (host.includes('finnhub.io')) return 'Finnhub API';
    return host || 'Unknown API';
  } catch {
    return 'Unknown API';
  }
}

function getEndpoint(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname || '';
  } catch {
    return '';
  }
}

function extractErrorDetail(error: any): string | null {
  const payload = error?.error;

  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim();
  }

  if (Array.isArray(payload) && payload.length) {
    const first = payload[0];
    if (typeof first === 'string' && first.trim()) {
      return first.trim();
    }
    if (first && typeof first === 'object') {
      const msg = first.message || first.error || first.detail || first.reason;
      if (typeof msg === 'string' && msg.trim()) {
        return msg.trim();
      }
    }
  }

  if (payload && typeof payload === 'object') {
    const msg = payload.message || payload.error || payload.detail || payload.reason;
    const code = payload.code || payload.errorCode;
    if (typeof msg === 'string' && msg.trim()) {
      return code ? `${code}: ${msg.trim()}` : msg.trim();
    }
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return null;
}

function buildErrorMessage(url: string, error: any): string {
  const apiSource = getApiSource(url);
  const endpoint = getEndpoint(url);
  const statusPart = error?.status
    ? `HTTP ${error.status}${error?.statusText ? ` ${error.statusText}` : ''}`
    : 'Request failed';
  const detail = extractErrorDetail(error);
  const context = endpoint ? `${apiSource} (${endpoint})` : apiSource;
  const message = detail
    ? `${context}: ${statusPart} - ${detail}`
    : `${context}: ${statusPart}.`;

  return message.length > 320 ? `${message.slice(0, 317)}...` : message;
}

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notificationService = inject(NotificationService);
  const authService = inject(AuthService);

  return next(req).pipe(
    catchError(error => {
      const isAlpacaRequest = req.url.includes('alpaca.markets');
      const isFmpRequest = req.url.includes('financialmodelingprep.com');
      const isFinnhubRequest = req.url.includes('finnhub.io');
      const isLoginRequest = isAlpacaRequest && req.url.includes('/v2/account') && !authService.isAuthenticated();
      const isGracefullyHandledFmpRead = isFmpRequest && req.method === 'GET';
      const isGracefullyHandledFinnhubRead = isFinnhubRequest && req.method === 'GET';

      // Rate limit: always surface a persistent banner naming the API, even for
      // reads that are otherwise handled silently (FMP/Finnhub GETs).
      if (error.status === 429) {
        notificationService.showRateLimit(getApiSource(req.url));
      }

      if (isGracefullyHandledFmpRead || isGracefullyHandledFinnhubRead) {
        // Expected on free-tier / premium-gated endpoints (e.g. 402 ratios-ttm) — callers fall back gracefully.
        console.debug('ErrorInterceptor (handled read):', req.url, 'status:', error.status);
      } else {
        console.log('ErrorInterceptor caught:', req.url, 'status:', error.status, 'body:', error.error);
      }

      if (error.status === 401 && isAlpacaRequest && !isLoginRequest) {
        console.log('ErrorInterceptor: credentials invalid, redirecting to login');
        authService.logout();
      } else if (!isLoginRequest && !isGracefullyHandledFmpRead && !isGracefullyHandledFinnhubRead && error.status !== 429) {
        const message = buildErrorMessage(req.url, error);
        console.log('ErrorInterceptor: showing notification:', message);
        notificationService.showError(message);
      }

      return throwError(() => error);
    })
  );
};
