// What the builder route does with a location: act once on a `#t=` fragment, clear it from the address
// bar, then open the linked template or hold it until the person allows replacing their draft. Free of
// React so it can be tested; useTemplateLink wires it to the router and to state.
import { readTemplateLinkPayload } from 'ffmpeg-video-composer/src/core/template-link/index.ts';
import type { TemplateLinkImport } from '@/application/usecases/template-link/open-template-link';

export type OpenedLink = Extract<TemplateLinkImport, { kind: 'opened' }>;
export type SettledLink = Exclude<TemplateLinkImport, { kind: 'none' }>;

export interface TemplateLinkLocation {
  pathname: string;
  search: string;
  hash: string;
}

export interface TemplateLinkFlowDeps {
  importLink: (hash: string) => Promise<TemplateLinkImport>;
  navigate: (to: { pathname: string; search: string }, options: { replace: true }) => unknown;
  /** The fragment was decoded (whatever came of it). */
  onSettled: () => void;
  /** Show this result: a template to open, or why the link could not be opened. */
  onOpen: (result: SettledLink) => void;
  /** A template to open once the person allows replacing the open draft. */
  onPending: (link: OpenedLink) => void;
}

export function createTemplateLinkFlow(deps: TemplateLinkFlowDeps) {
  // The fragment last acted on: effects can run twice for one navigation (StrictMode), a link once.
  let handled: string | null = null;

  /** `arriving`: the link came with the page, so there is no draft to lose yet. */
  const receive = async (location: TemplateLinkLocation, arriving: boolean): Promise<void> => {
    if (readTemplateLinkPayload(location.hash) === null) {
      handled = null;

      return;
    }

    if (handled === location.hash) return;

    handled = location.hash;
    // The fragment never stays in the address bar: a reload must not reopen it over the person's edits.
    Promise.resolve(deps.navigate({ pathname: location.pathname, search: location.search }, { replace: true })).catch(
      () => {}
    );

    const result = await deps.importLink(location.hash);
    deps.onSettled();

    if (result.kind === 'none') return;

    if (result.kind === 'opened' && !arriving) {
      deps.onPending(result);

      return;
    }

    deps.onOpen(result);
  };

  return { receive };
}
