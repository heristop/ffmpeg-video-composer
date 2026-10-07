// The fetch every AI SDK provider gets: no cookies, no referrer, and no SDK `user-agent` header
// (a non-safelisted header that would widen the CORS preflight). Wraps the given fetch, or the
// global one at call time so tests can stub it.
type Fetch = typeof globalThis.fetch;

export function browserFetch(base?: Fetch): Fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete('user-agent');

    return (base ?? globalThis.fetch)(input, {
      ...init,
      headers,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  };
}
