import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpResponse } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { fetchFnWithState } from '../../utils/fetch-rx';
import { AlpacaAccount, AlpacaErrorBody } from '../../models/alpaca.models';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  keyId = '';
  secretKey = '';

  private authService = inject(AuthService);
  private router = inject(Router);

  fetch = fetchFnWithState<AlpacaAccount, AlpacaErrorBody, { keyId: string; secretKey: string }>((credentials) =>
    this.authService.login(credentials.keyId, credentials.secretKey)
  );

  fetchState = computed(() => {
    const { nascent, prefetchOrBusy, okRes, errorRes, errorResOrException, busy, exception } = this.fetch.state();
    return {
      nascent,
      prefetchOrBusy,
      busy,
      okRes,
      errorRes: errorRes as HttpResponse<AlpacaErrorBody> | undefined,
      errorResOrException,
      exception,
    };
  });

  async onSubmit(): Promise<void> {
    const result = await this.fetch({ keyId: this.keyId, secretKey: this.secretKey });
    if (result.okRes) {
      this.authService.storeCredentials(this.keyId, this.secretKey);
      this.router.navigate(['/dashboard']);
    }
  }
}
