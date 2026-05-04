import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService, Notification } from '../../services/notification.service';

@Component({
  selector: 'app-notification',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="notification-container">
      @for (notification of notifications$ | async; track notification.id) {
        <div class="notification" [class]="'notification--' + notification.type" (click)="dismiss(notification.id)">
          <span class="notification__message">{{ notification.message }}</span>
          <button class="notification__close">&times;</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .notification-container {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 400px;
    }
    .notification {
      padding: 12px 16px;
      border-radius: 6px;
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      animation: slideIn 0.3s ease;
    }
    .notification--error {
      background: #dc3545;
    }
    .notification--success {
      background: #28a745;
    }
    .notification--info {
      background: #17a2b8;
    }
    .notification__close {
      background: none;
      border: none;
      color: #fff;
      font-size: 18px;
      cursor: pointer;
      margin-left: 12px;
    }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `]
})
export class NotificationComponent {
  private notificationService = inject(NotificationService);
  notifications$ = this.notificationService.notifications$;

  dismiss(id: number): void {
    this.notificationService.dismiss(id);
  }
}
