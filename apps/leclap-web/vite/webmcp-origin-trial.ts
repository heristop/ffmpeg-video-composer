import type { Plugin } from 'vite';

// Chrome ships WebMCP (`document.modelContext`) behind an origin trial: a deployment that registered
// for it sets VITE_WEBMCP_OT_TOKEN (shell or .env) and every page gets the trial's meta tag. Without the
// token nothing is injected, so local builds and forks stay unchanged. The token is public by design (it
// is bound to the registered origin), so it may live in the HTML.
const TOKEN = /^[A-Za-z0-9+/=]{20,4096}$/;

export function webMcpOriginTrial(): Plugin {
  let token = '';

  return {
    name: 'leclap-webmcp-origin-trial',
    configResolved(config) {
      const value = (config.env.VITE_WEBMCP_OT_TOKEN as string | undefined)?.trim() ?? '';

      if (value !== '' && !TOKEN.test(value)) throw new Error('VITE_WEBMCP_OT_TOKEN is not an origin-trial token');

      token = value;
    },
    transformIndexHtml() {
      if (!token) return [];

      return [{ tag: 'meta', attrs: { 'http-equiv': 'origin-trial', content: token }, injectTo: 'head' }];
    },
  };
}
