import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth.service';

describe('LoginComponent', () => {
  let httpTesting: HttpTestingController;
  let router: Router;
  let authService: AuthService;
  let fixture: ReturnType<typeof TestBed.createComponent<LoginComponent>>;
  let component: LoginComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'dashboard', component: LoginComponent },
          { path: 'login', component: LoginComponent },
        ]),
      ],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    authService = TestBed.inject(AuthService);
    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('happy path', () => {
    it('should navigate to dashboard and store credentials on successful login', async () => {
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      component.keyId = 'valid-key';
      component.secretKey = 'valid-secret';

      const loginPromise = component.onSubmit();

      const req = httpTesting.expectOne(
        'https://paper-api.alpaca.markets/v2/account'
      );
      expect(req.request.headers.get('APCA-API-KEY-ID')).toBe('valid-key');
      expect(req.request.headers.get('APCA-API-SECRET-KEY')).toBe('valid-secret');

      req.flush({ status: 'ACTIVE', account_number: '123' });

      await loginPromise;
      fixture.detectChanges();

      expect(authService.isAuthenticated()).toBe(true);
      expect(sessionStorage.getItem('alpaca_key_id')).toBe('valid-key');
      expect(sessionStorage.getItem('alpaca_secret_key')).toBe('valid-secret');
      expect(navigateSpy).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should be busy while request is in flight', async () => {
      component.keyId = 'valid-key';
      component.secretKey = 'valid-secret';

      const loginPromise = component.onSubmit();

      // Signal should indicate busy state
      expect(component.fetchState().busy).toBe(true);
      expect(component.fetchState().prefetchOrBusy).toBe(true);

      const req = httpTesting.expectOne(
        'https://paper-api.alpaca.markets/v2/account'
      );
      req.flush({ status: 'ACTIVE' });

      await loginPromise;

      expect(component.fetchState().busy).toBe(false);
    });
  });

  describe('unhappy path', () => {
    it('should show invalid credentials message on 401', async () => {
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      component.keyId = 'bad-key';
      component.secretKey = 'bad-secret';

      const loginPromise = component.onSubmit();

      const req = httpTesting.expectOne(
        'https://paper-api.alpaca.markets/v2/account'
      );
      req.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

      await loginPromise;
      fixture.detectChanges();

      const errorEl = fixture.nativeElement.querySelector('.error-message') as HTMLElement;
      expect(errorEl).toBeTruthy();
      expect(errorEl.textContent).toContain('Invalid API Key or Secret');
      expect(authService.isAuthenticated()).toBe(false);
      expect(navigateSpy).not.toHaveBeenCalledWith(['/dashboard']);
    });

    it('should show invalid credentials message on 403', async () => {
      component.keyId = 'forbidden-key';
      component.secretKey = 'forbidden-secret';

      const loginPromise = component.onSubmit();

      const req = httpTesting.expectOne(
        'https://paper-api.alpaca.markets/v2/account'
      );
      req.flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });

      await loginPromise;
      fixture.detectChanges();

      const errorEl = fixture.nativeElement.querySelector('.error-message') as HTMLElement;
      expect(errorEl).toBeTruthy();
      expect(errorEl.textContent).toContain('Invalid API Key or Secret');
    });

    it('should show generic error message on 500', async () => {
      component.keyId = 'some-key';
      component.secretKey = 'some-secret';

      const loginPromise = component.onSubmit();

      const req = httpTesting.expectOne(
        'https://paper-api.alpaca.markets/v2/account'
      );
      req.flush('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });

      await loginPromise;
      fixture.detectChanges();

      const errorEl = fixture.nativeElement.querySelector('.error-message') as HTMLElement;
      expect(errorEl).toBeTruthy();
      expect(errorEl.textContent).toContain('Unable to connect');
    });

    it('should re-enable form after error', async () => {
      component.keyId = 'bad-key';
      component.secretKey = 'bad-secret';

      const loginPromise = component.onSubmit();

      const req = httpTesting.expectOne(
        'https://paper-api.alpaca.markets/v2/account'
      );
      req.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

      await loginPromise;
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      expect(button.textContent).toContain('Log In');
    });
  });
});
