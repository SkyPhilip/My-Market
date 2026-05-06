import {
  Observable,
  OperatorFunction,
  catchError,
  isObservable,
  map,
  of,
  pipe,
  switchMap,
  throwError,
} from 'rxjs';
import { ResponseOrException } from './fetch-rx.types';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';

/**
 * HttpErrorResponse objects are `next`ed as `HttpResponse` objects.  Only
 * exceptions are thrown, not `HttpErrorResponse` objects.
 */
export function unthrowErrorResponse<ErrorT, SuccessT>(): OperatorFunction<
  HttpResponse<SuccessT>,
  HttpResponse<SuccessT | ErrorT>
> {
  return catchError((error: unknown) => {
    if (error instanceof HttpErrorResponse) {
      const res = httpErrorResponseToHttpResponse<ErrorT, SuccessT>(error);
      return of(res);
    } else {
      return throwError(() => error);
    }
  });
}

/**
 * Converts the HttpErrorResponse to a HttpResponse.
 */
export function httpErrorResponseToHttpResponse<ErrorT, SuccessT>(
  errorResponse: HttpErrorResponse,
) {
  return new HttpResponse({
    ...errorResponse,
    body: errorResponse.error,
    url: errorResponse.url ?? undefined,
  }) as HttpResponse<SuccessT | ErrorT>;
}

/**
 * Unthrows error responses ({@link unthrowErrorResponse}) and materializes the
 * pipe into an object with either the response or the exception.
 */
export function materializeResponse<ErrorT, SuccessT>(): OperatorFunction<
  HttpResponse<SuccessT>,
  ResponseOrException<HttpResponse<SuccessT | ErrorT>>
> {
  return pipe(
    unthrowErrorResponse<ErrorT, SuccessT>(),
    map((res) => ({ res })),
    catchError((exception) => of({ exception })),
  );
}

/**
 * If it's not already an observable return `of(arg)`, otherwise return the
 * observable itself.
 */
export function wrapInObservable<T>(result: Observable<T> | T): Observable<T> {
  return isObservable(result) ? result : of(result);
}

/**
 * Similar to `of` this returns an observable which emits once with the
 * callback's return value. Unlike {@link of}, exceptions thrown within the
 * callback are thrown into the returned Observable.
 */
export function observablify<NextT, CallbackArgT>(
  callback: (arg: CallbackArgT) => Observable<NextT>,
  arg: CallbackArgT,
): Observable<NextT> {
  try {
    return wrapInObservable(callback(arg));
  } catch (error) {
    return throwError(() => error);
  }
}

/**
 * {@link switchMap} to a {@link materializeResponse} and materializes any javascript
 * exceptions thrown in the callback.
 *
 * Exceptions which cross the `switchMap` boundary (both javascript exceptions
 * and RxJS exceptions) cause the internal subscription in the switchMap to
 * unsubscribe.  We can prevent this by doing both of these:
 * 1. Use catchError for the exceptions which travel down the switchMapped RxJS
 *    pipe (which is what {@link materializeResponse} does internally).
 * 1. Use try/catch for the exceptions thrown while creating the switchMapped
 *    RxJS pipe (which is what {@link observablify} does).
 */
export function materializedResponseSwitchMap<ErrorT, SuccessT = unknown, CallbackArgT = unknown>(
  callback: (arg: CallbackArgT) => Observable<HttpResponse<SuccessT>>,
): OperatorFunction<CallbackArgT, ResponseOrException<HttpResponse<SuccessT | ErrorT>>> {
  return switchMap((arg) =>
    observablify(callback, arg).pipe(materializeResponse<ErrorT, SuccessT>()),
  );
}
