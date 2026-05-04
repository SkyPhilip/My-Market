import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface Notification {
  id: number;
  type: 'error' | 'success' | 'info';
  message: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private idCounter = 0;
  private notificationsSubject = new BehaviorSubject<Notification[]>([]);
  notifications$ = this.notificationsSubject.asObservable();

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
    const current = this.notificationsSubject.value;
    this.notificationsSubject.next(current.filter(n => n.id !== id));
  }

  private addNotification(type: Notification['type'], message: string): void {
    const id = ++this.idCounter;
    const notification: Notification = { id, type, message };
    const current = this.notificationsSubject.value;
    this.notificationsSubject.next([...current, notification]);

    setTimeout(() => this.dismiss(id), 5000);
  }
}
