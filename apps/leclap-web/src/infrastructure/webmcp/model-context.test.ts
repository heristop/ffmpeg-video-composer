import { describe, expect, it } from 'vitest';
import { detectModelContext, registerTools } from './model-context';
import type { ModelContextTool, RegisterToolOptions } from './types';

// A spec-shaped ModelContext: an EventTarget holding tools by name, honouring the registration signal,
// rejecting duplicates and announcing changes with `toolchange`.
class FakeModelContext extends EventTarget {
  readonly tools = new Map<string, ModelContextTool>();

  registerTool(tool: ModelContextTool, options: RegisterToolOptions = {}): Promise<void> {
    if (this.tools.has(tool.name)) {
      return Promise.reject(new DOMException(`Duplicate ${tool.name}`, 'InvalidStateError'));
    }

    if (options.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));

    this.tools.set(tool.name, tool);
    options.signal?.addEventListener('abort', () => {
      this.tools.delete(tool.name);
      this.dispatchEvent(new Event('toolchange'));
    });
    this.dispatchEvent(new Event('toolchange'));

    return Promise.resolve();
  }
}

// The early-preview shape: registerTool returns an { unregister } handle and ignores signals.
class LegacyModelContext {
  readonly tools = new Map<string, ModelContextTool>();

  registerTool(tool: ModelContextTool) {
    this.tools.set(tool.name, tool);

    return {
      unregister: () => {
        this.tools.delete(tool.name);
      },
    };
  }
}

function tool(name: string): ModelContextTool {
  return { name, description: `${name} tool`, inputSchema: { type: 'object' }, execute: () => Promise.resolve('ok') };
}

describe('detectModelContext', () => {
  it('prefers document.modelContext over the deprecated navigator alias', () => {
    const fromDocument = new FakeModelContext();
    const fromNavigator = new FakeModelContext();

    expect(
      detectModelContext({
        isSecureContext: true,
        document: { modelContext: fromDocument },
        navigator: { modelContext: fromNavigator },
      })
    ).toBe(fromDocument);
    expect(detectModelContext({ isSecureContext: true, navigator: { modelContext: fromNavigator } })).toBe(
      fromNavigator
    );
  });

  it('finds nothing in an insecure context, without the API, or without registerTool', () => {
    const context = new FakeModelContext();

    expect(detectModelContext({ isSecureContext: false, document: { modelContext: context } })).toBeNull();
    expect(detectModelContext({ isSecureContext: true, document: {}, navigator: {} })).toBeNull();
    expect(detectModelContext({ isSecureContext: true, document: { modelContext: {} } })).toBeNull();
    expect(detectModelContext(null)).toBeNull();
  });
});

describe('registerTools', () => {
  it('registers every tool and unregisters them all on abort, with toolchange events', async () => {
    const context = new FakeModelContext();
    let changes = 0;
    context.addEventListener('toolchange', () => {
      changes += 1;
    });
    const controller = new AbortController();
    const reports = await registerTools(context, [tool('a'), tool('b')], controller.signal);

    expect(reports).toEqual([
      { name: 'a', ok: true },
      { name: 'b', ok: true },
    ]);
    expect([...context.tools.keys()]).toEqual(['a', 'b']);

    controller.abort();

    expect(context.tools.size).toBe(0);
    expect(changes).toBe(4);
  });

  it('isolates a rejected tool from the others', async () => {
    const context = new FakeModelContext();
    await context.registerTool(tool('taken'));
    const reports = await registerTools(context, [tool('taken'), tool('fresh')], new AbortController().signal);

    expect(reports[0]).toMatchObject({ name: 'taken', ok: false, error: expect.stringContaining('Duplicate') });
    expect(reports[1]).toEqual({ name: 'fresh', ok: true });
  });

  it('unregisters through the legacy handle', async () => {
    const context = new LegacyModelContext();
    const controller = new AbortController();
    await registerTools(context, [tool('a')], controller.signal);

    expect(context.tools.has('a')).toBe(true);
    controller.abort();
    expect(context.tools.has('a')).toBe(false);
  });

  it('registers nothing on an aborted signal', async () => {
    const context = new FakeModelContext();
    const controller = new AbortController();
    controller.abort();

    expect(await registerTools(context, [tool('a')], controller.signal)).toEqual([
      { name: 'a', ok: false, error: 'aborted' },
    ]);
    expect(context.tools.size).toBe(0);
  });
});
