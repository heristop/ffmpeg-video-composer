// `Promise.withResolvers()` without the built-in: it needs Chrome 119 / Safari 17.4, and the phone's HTML layer
// page runs on older WebViews (docs/on-device-compilation.md#html-layers).

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });

  return { promise, resolve, reject };
}
