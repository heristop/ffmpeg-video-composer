// The routing logic behind useTemplateLink: which fragment is acted on, when the address bar is
// cleared, and whether a link opens at once or waits for the person to allow replacing their draft.
import { describe, expect, it, vi } from 'vitest';
import type { TemplateLinkImport } from '@/application/usecases/template-link/open-template-link';
import type { Template } from '@/services/templateService';
import { createTemplateLinkFlow, type TemplateLinkLocation } from './template-link-flow';

const template = { id: 'draft', name: 'Linked', source: 'user' } as Template;
const opened: TemplateLinkImport = { kind: 'opened', template, rebind: [] };
const failed: TemplateLinkImport = { kind: 'failed', code: 'corrupt', details: [] };

function at(hash: string): TemplateLinkLocation {
  return { pathname: '/studio/builder', search: '?tab=scene', hash };
}

function setup(result: TemplateLinkImport = opened) {
  const deps = {
    importLink: vi.fn(async (_hash: string) => result),
    navigate: vi.fn(),
    onSettled: vi.fn(),
    onOpen: vi.fn(),
    onPending: vi.fn(),
  };

  return { deps, flow: createTemplateLinkFlow(deps) };
}

describe('template link flow', () => {
  it('ignores a location without a template fragment', async () => {
    const { deps, flow } = setup();

    await flow.receive(at(''), true);
    await flow.receive(at('#projects'), false);

    expect(deps.importLink).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('clears the fragment from the address bar, keeping the path and query', async () => {
    const { deps, flow } = setup();

    await flow.receive(at('#t=v1.abc'), true);

    expect(deps.navigate).toHaveBeenCalledWith(
      { pathname: '/studio/builder', search: '?tab=scene' },
      { replace: true }
    );
    expect(deps.importLink).toHaveBeenCalledWith('#t=v1.abc');
  });

  it('opens a link that came with the page at once', async () => {
    const { deps, flow } = setup();

    await flow.receive(at('#t=v1.abc'), true);

    expect(deps.onSettled).toHaveBeenCalled();
    expect(deps.onOpen).toHaveBeenCalledWith(opened);
    expect(deps.onPending).not.toHaveBeenCalled();
  });

  it('holds a link pasted over an open draft until the person allows it', async () => {
    const { deps, flow } = setup();

    await flow.receive(at('#t=v1.abc'), false);

    expect(deps.onPending).toHaveBeenCalledWith(opened);
    expect(deps.onOpen).not.toHaveBeenCalled();
  });

  it('reports a broken link at once, even over an open draft', async () => {
    const { deps, flow } = setup(failed);

    await flow.receive(at('#t=v1.abc'), false);

    expect(deps.onOpen).toHaveBeenCalledWith(failed);
    expect(deps.onPending).not.toHaveBeenCalled();
  });

  it('imports a link once when the effect runs twice for one navigation (StrictMode)', async () => {
    const { deps, flow } = setup();

    await Promise.all([flow.receive(at('#t=v1.abc'), true), flow.receive(at('#t=v1.abc'), true)]);

    expect(deps.importLink).toHaveBeenCalledTimes(1);
    expect(deps.onOpen).toHaveBeenCalledTimes(1);
  });

  it('opens the same link again once it was cleared from the address bar and pasted back', async () => {
    const { deps, flow } = setup();

    await flow.receive(at('#t=v1.abc'), true);
    await flow.receive(at(''), false);
    await flow.receive(at('#t=v1.abc'), false);

    expect(deps.importLink).toHaveBeenCalledTimes(2);
    expect(deps.onPending).toHaveBeenCalledWith(opened);
  });
});
