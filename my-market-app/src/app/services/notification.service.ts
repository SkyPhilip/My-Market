import { Injectable, signal } from '@angular/core';

export interface Notification {
  id: number;
  type: 'error' | 'success' | 'info';
  message: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private idCounter = 0;
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
    this.notifications.update(current => current.filter(n => n.id !== id));
  }

  private addNotification(type: Notification['type'], message: string): void {
    const id = ++this.idCounter;
    const notification: Notification = { id, type, message };
    this.notifications.update(current => [...current, notification]);

    setTimeout(() => this.dismiss(id), 5000);
  }
}
