import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: 'login', loadComponent: () => import('./components/login/login.component').then(m => m.LoginComponent) },
  { path: 'dashboard', loadComponent: () => import('./components/dashboard/dashboard.component').then(m => m.DashboardComponent), canActivate: [authGuard] },
  { path: 'settings', loadComponent: () => import('./components/settings/settings.component').then(m => m.SettingsComponent), canActivate: [authGuard] },
  { path: 'money-flow', loadComponent: () => import('./components/money-flow/money-flow.component').then(m => m.MoneyFlowComponent), canActivate: [authGuard] },
  { path: 'high-yield', loadComponent: () => import('./components/high-yield/high-yield.component').then(m => m.HighYieldComponent), canActivate: [authGuard] },
  { path: '**', redirectTo: '/dashboard' }
];
