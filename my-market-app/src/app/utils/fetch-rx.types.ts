import { WritableSignal } from '@angular/core';
import { Observable } from 'rxjs';

export interface ResponseOrException<HttpResponseT> {
  res?: HttpResponseT;
  exception?: unknown;
}

export interface BeforeFirstFetch {
  busy: false;
  prefetchOrBusy: true;
  nascent: true;
  prefetch: true;
  ok: undefined;
  res: undefined;
  okRes: undefined;
  errorRes: undefined;
  exception: undefined;
  errorResOrException: undefined;
}

export interface DuringFirstFetch {
  busy: true;
  prefetchOrBusy: true;
  nascent: true;
  prefetch: false;
  ok: undefined;
  res: undefined;
  okRes: undefined;
  errorRes: undefined;
  exception: undefined;
  errorResOrException: undefined;
}

export interface AfterOkResponse<HttpResponseT> {
  busy: false;
  prefetchOrBusy: false;
  nascent: false;
  prefetch: false;
  ok: true;
  res: HttpResponseT;
  okRes: HttpResponseT;
  errorRes: undefined;
  exception: undefined;
  errorResOrException: undefined;
}

export interface AfterNotOkResponse<HttpErrorResponseT> {
  busy: false;
  prefetchOrBusy: false;
  nascent: false;
  prefetch: false;
  ok: false;
  res: HttpErrorResponseT;
  okRes: undefined;
  errorRes: HttpErrorResponseT;
  exception: undefined;
  errorResOrException: HttpErrorResponseT;
}

export interface AfterException {
  busy: false;
  prefetchOrBusy: false;
  nascent: false;
  prefetch: false;
  ok: false;
  res: undefined;
  okRes: undefined;
  errorRes: undefined;
  exception: unknown;
  errorResOrException: unknown;
}

export interface SubsequentFetchAfterOkResponse<HttpResponseT> {
  busy: true;
  prefetchOrBusy: true;
  nascent: false;
  prefetch: false;
  ok: true;
  res: HttpResponseT;
  okRes: HttpResponseT;
  errorRes: undefined;
  exception: undefined;
  errorResOrException: undefined;
}

export interface SubsequentFetchAfterNotOkResponse<
  HttpErrorResponseT,
  HttpErrorResponseRollupT = HttpErrorResponseT,
> {
  busy: true;
  prefetchOrBusy: true;
  nascent: false;
  prefetch: false;
  ok: false;
  res: HttpErrorResponseT;
  okRes: undefined;
  errorRes: HttpErrorResponseRollupT;
  exception: undefined;
  errorResOrException: HttpErrorResponseRollupT;
}

export interface SubsequentFetchAfterException {
  busy: true;
  prefetchOrBusy: true;
  nascent: false;
  prefetch: false;
  ok: false;
  res: undefined;
  okRes: undefined;
  errorRes: undefined;
  exception: unknown;
  errorResOrException: unknown;
}

/**
 * The union of all possible fetchAndSignal result states which makes Typescript
 * correctly type everything.
 */
export type FetchState<HttpResponseT, HttpErrorResponseT> =
  | BeforeFirstFetch
  | DuringFirstFetch
  | AfterOkResponse<HttpResponseT>
  | AfterNotOkResponse<HttpErrorResponseT>
  | AfterException
  | SubsequentFetchAfterOkResponse<HttpResponseT>
  | SubsequentFetchAfterNotOkResponse<HttpErrorResponseT>
  | SubsequentFetchAfterException;

export type FetchFunctionWithStateSignal<HttpResponseT, HttpErrorResponseT, TRequestData> = ((
  requestData: TRequestData,
) => Promise<FetchState<HttpResponseT, HttpErrorResponseT>>) & {
  state: WritableSignal<FetchState<HttpResponseT, HttpErrorResponseT>>;
  /**
   * An Observable which mirrors this.state.
   * @deprecated
   */
  state$: Observable<FetchState<HttpResponseT, HttpErrorResponseT>>;
};
