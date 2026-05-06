import { HttpResponse } from '@angular/common/http';
import { DestroyRef, inject, Injector, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Observable,
  Subject,
  BehaviorSubject,
  tap,
  filter,
  take,
  firstValueFrom,
  defaultIfEmpty,
} from 'rxjs';
import { FetchFunctionWithStateSignal, FetchState, ResponseOrException } from './fetch-rx.types';
import { materializedResponseSwitchMap } from './operators';

export * from './fetch-rx.types';

/**
 * Converts an Angular HttpClient RxJS response into a set of easy-to-use
 * signals.
 *
 * Usage:
 *
 * ```html
 * ㉿if (prefetch() || busy()) {
 *   <app-spinner></app-spinner>
 *
 * } ㉿else if (ok()) {
 *   <button (click)="fetchThing()">refresh</button>
 *   <!-- show the thing -->
 *   {{ okRes().body | json }}
 *
 * } ㉿else if (res()?.status === 403) {
 *   <app-unauthorized></app-unauthorized>
 *
 * } ㉿else if (res()?.status === 404) {
 *   <app-not-found></app-not-found>
 *
 * } ㉿else if (res()) {
 *   <span>response not ok</span>
 *   {{ res().body | json }}
 *   <button (click)="fetchThing()">try again</button>
 *
 * } ㉿else {
 *   <span>exception</span>
 *   {{ exception() | json }}
 *   <button (click)="fetchThing()">try again</button>
 * }
 * ```
 * ```ts
 * export class ThingSideSheetComponent {
 *   fetchThing = fetchFnWithState<{ prop1: number; prop2: number }, number>(() =>
 *     this.mockGetMyThing({
 *       prop1: 123,
 *       prop2: 1234,
 *     })
 *   );
 *
 *   fetchState = this.fetchThing.state;
 *   prefetch = computed(() => this.fetchState().prefetch);
 *   busy = computed(() => this.fetchState().busy);
 *   ok = computed(() => this.fetchState().ok);
 *   res = computed(() => this.fetchState().res);
 *   okRes = computed(() => this.fetchState().okRes);
 *   exception = computed(() => this.fetchState().exception);
 *
 *   ngOnInit() {
 *     this.fetchThing();
 *   }
 *
 *   // This would be an actual network call
 *   mockGetMyThing(opts: any) {
 *     return of(
 *       new HttpResponse({
 *         status: 500,
 *         body: opts,
 *       })
 *     ).pipe(delay(2000));
 *   }
 * }
 * ```
 */
export function fetchFnWithState<
  T,
  ErrorT = unknown,
  TRequestData = void,
  HttpResponseT = HttpResponse<T>,
  HttpResponseErrorT = HttpResponse<ErrorT>,
>(
  callback: (requestData: TRequestData) => Observable<HttpResponseT>,
  opts: { injector?: Injector } = {},
): FetchFunctionWithStateSignal<HttpResponseT, HttpResponseErrorT, TRequestData> {
  const injector = opts.injector || inject(Injector);

  const fetch$ = new Subject<TRequestData>();

  const state = signal<FetchState<HttpResponseT, HttpResponseErrorT>>({
    busy: false,
    prefetchOrBusy: true,
    nascent: true,
    prefetch: true,
    ok: undefined,
    res: undefined,
    exception: undefined,
    okRes: undefined,
    errorRes: undefined,
    errorResOrException: undefined,
  });
  const state$ = new BehaviorSubject<FetchState<HttpResponseT, HttpResponseErrorT>>(state());

  function beBusy() {
    state.set({ ...state(), prefetch: false, busy: true, prefetchOrBusy: true });
    state$.next(state());
  }

  fetch$
    .pipe(
      tap(() => beBusy()),
      materializedResponseSwitchMap<ErrorT, T, TRequestData>(
        callback as (arg: TRequestData) => Observable<any>,
      ),
      takeUntilDestroyed(injector.get(DestroyRef)),
    )
    .subscribe(({ res, exception }: ResponseOrException<HttpResponse<T | ErrorT>>) => {
      state.set({
        busy: false,
        prefetchOrBusy: false,
        nascent: false,
        prefetch: false,
        ok: res ? !!res.ok : undefined,
        res,
        okRes: res?.ok ? res : undefined,
        errorRes: res?.ok ? undefined : res,
        exception,
        errorResOrException: (res?.ok ? undefined : res) ?? exception,
      } as any);

      state$.next(state());
    });

  const result = (requestData: TRequestData) =>
    untracked(() => {
      fetch$.next(requestData);
      return firstValueFrom(
        result.state$.pipe(
          filter(({ busy, nascent, prefetch }) => !busy && !nascent && !prefetch),
          defaultIfEmpty({} as FetchState<HttpResponseT, HttpResponseErrorT>),
          take(1),
        ),
      );
    });
  result.state = state;
  result.state$ = state$.pipe(takeUntilDestroyed(injector.get(DestroyRef)));

  return result;
}
