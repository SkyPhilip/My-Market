import { Injectable, signal } from '@angular/core';

export interface Notification {
  id: number;
  type: 'error' | 'success' | 'info';
  message: string;
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

  dismiss(id: number): void {
    this.clearDismissTimer(id);
    this.notifications.update(current => current.filter(n => n.id !== id));
  }

  private addNotification(type: Notification['type'], message: string): void {
    const existing = this.notifications().find(n => n.type === type && n.message === message);
    if (existing) {
      this.scheduleDismiss(existing.id);
      return;
    }

    const id = ++this.idCounter;
    const notification: Notification = { id, type, message };
    this.notifications.update(current => [...current, notification]);
    this.scheduleDismiss(id);
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
