import { Injectable, signal } from '@angular/core';

export interface Notification {
  id: number;
  type: 'error' | 'success' | 'info';
  message: string;
  persistent?: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private static readonly DISMISS_MS = 5000;

  private idCounter = 0;
  private readonly dismissTimers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly notifications = signal<Notification[]>([]);

  showError(message: string): void {
    this.addNotification('error', message);
  }

  showSuccess(message: string): void {
    this.addNotification('success', message);
  }

  showInfo(message: string): void {
    this.addNotification('info', message);
  }

  /** Persistent (non-auto-dismissing) banner for API rate-limit (HTTP 429). */
  showRateLimit(apiSource: string): void {
    this.addNotification(
      'error',
      `${apiSource}: daily rate limit reached (HTTP 429). Requests to this API are blocked until the quota resets.`,
      true,
    );
  }

  dismiss(id: number): void {
    this.clearDismissTimer(id);
    this.notifications.update(current => current.filter(n => n.id !== id));
  }

  private addNotification(type: Notification['type'], message: string, persistent = false): void {
    const existing = this.notifications().find(n => n.type === type && n.message === message);
    if (existing) {
      if (!persistent) this.scheduleDismiss(existing.id);
      return;
    }

    const id = ++this.idCounter;
    const notification: Notification = { id, type, message, persistent };
    this.notifications.update(current => [...current, notification]);
    if (!persistent) this.scheduleDismiss(id);
  }

  private scheduleDismiss(id: number): void {
    this.clearDismissTimer(id);
    const timer = setTimeout(() => {
      this.dismiss(id);
    }, NotificationService.DISMISS_MS);
    this.dismissTimers.set(id, timer);
  }

  private clearDismissTimer(id: number): void {
    const timer = this.dismissTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.dismissTimers.delete(id);
    }
  }
}
