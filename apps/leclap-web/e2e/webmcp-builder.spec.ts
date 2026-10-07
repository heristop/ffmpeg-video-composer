import { test, expect, type Page } from '@playwright/test';

// Browser-agent (WebMCP) tools on the studio builder, driven the way an agent would: through the dev
// polyfill (`?webmcp=polyfill`, which the dev server allows) and its `navigator.modelContextTesting`
// shim. No WASM is involved unless E2E_WASM=1 (render_preview / render_frames).

interface TestingShim {
  listTools: () => Array<{ name: string; inputSchema?: string }>;
  executeTool: (name: string, inputJson: string) => Promise<string | null>;
}

type ToolCallResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: Array<{ type: string; text: string }>;
};

const ALL_TOOLS = [
  'add_section',
  'edit_template',
  'get_motion_catalog',
  'get_sample',
  'get_template',
  'get_template_schema',
  'get_timeline',
  'list_samples',
  'list_sections',
  'load_sample',
  'move_section',
  'remove_section',
  'render_frames',
  'render_preview',
  'replace_template',
  'save_template',
  'select_section',
  'set_format',
  'set_music',
  'set_texts',
  'set_theme',
  'undo',
  'validate_template',
];

async function toolNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (navigator as unknown as { modelContextTesting: TestingShim }).modelContextTesting
      .listTools()
      .map((tool) => tool.name)
      .sort()
  );
}

async function callTool(page: Page, name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
  const raw = await page.evaluate(
    ([tool, input]) =>
      (navigator as unknown as { modelContextTesting: TestingShim }).modelContextTesting.executeTool(tool, input),
    [name, JSON.stringify(args)] as const
  );

  return JSON.parse(raw ?? '{}') as ToolCallResult;
}

async function openBlankBuilder(page: Page): Promise<void> {
  await page.goto('/studio/builder?webmcp=polyfill');
  await page.getByRole('dialog').getByRole('button', { name: 'Start blank' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(() => toolNames(page), { timeout: 15_000 }).toEqual(ALL_TOOLS);
}

test.describe('browser agent (WebMCP) tools', () => {
  test('without the polyfill flag and without native WebMCP, nothing loads and the pill stays hidden', async ({
    page,
  }) => {
    const loaded: string[] = [];
    page.on('request', (request) => {
      if (/usecases\/webmcp|webmcp-polyfill/.test(request.url())) loaded.push(request.url());
    });
    await page.goto('/studio/builder');
    await page.getByRole('dialog').getByRole('button', { name: 'Start blank' }).click();

    await expect(page.getByRole('textbox', { name: 'Template name' })).toBeVisible();
    await expect(page.locator('[data-agent-pill]')).toHaveCount(0);
    expect(await page.evaluate(() => 'modelContext' in document)).toBe(false);
    expect(loaded).toEqual([]);
  });

  test('an agent reads the template, adds a scene the user can see and undo', async ({ page }) => {
    await openBlankBuilder(page);

    const pill = page.locator('[data-agent-pill]');
    await expect(pill).toHaveAttribute('data-agent-pill', 'idle');

    const template = await callTool(page, 'get_template');
    expect(template.isError).toBeUndefined();
    const revision = template.structuredContent?.revision as string;
    expect(revision).toMatch(/^[0-9a-f]{64}$/);
    expect(template.structuredContent?.sectionCount).toBe(1);

    const lane = page.getByRole('toolbar', { name: 'Scenes' });
    await expect(lane.getByRole('button', { name: /Color background/ })).toHaveCount(0);

    const added = await callTool(page, 'add_section', {
      expectedRevision: revision,
      type: 'color_background',
      note: 'Opening title card',
    });
    expect(added.isError).toBeUndefined();
    expect(added.structuredContent?.changedPositions).toEqual([1]);

    // The new card appears, ringed, and is selected.
    await expect(lane.getByRole('button', { name: /Color background/ })).toBeVisible();
    await expect(page.locator('[data-agent-highlight]')).toHaveCount(1);

    // A stale revision is refused.
    const stale = await callTool(page, 'add_section', { expectedRevision: revision, type: 'form' });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent?.code).toBe('revision_conflict');

    // The activity drawer lists the edit with its note and an Undo.
    await pill.click();
    const popover = page.getByRole('dialog', { name: 'Browser agent' });
    await expect(popover).toBeVisible();
    const entries = popover.getByRole('listitem');
    // Newest first: the refused call, then the edit, then the read.
    await expect(entries.nth(0)).toContainText('Added a scene');
    await expect(entries.nth(0)).toContainText('Failed · template changed meanwhile');
    await expect(entries.nth(1)).toContainText('Done');
    await expect(entries.nth(1)).toContainText("Agent's note: Opening title card");
    await expect(entries.nth(2)).toContainText('Read the template');
    await expect(popover.getByRole('button', { name: 'Undo: Added a scene' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();

    // The agent's edit is one ordinary undo step.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(lane.getByRole('button', { name: /Color background/ })).toHaveCount(0);
    expect((await callTool(page, 'get_template')).structuredContent?.revision).toBe(revision);
  });

  test('ask-before-every-edit shows an in-page confirmation; declining commits nothing', async ({ page }) => {
    await openBlankBuilder(page);
    await page.locator('[data-agent-pill]').click();
    await page.getByRole('switch', { name: 'Ask before every edit' }).click();
    await page.keyboard.press('Escape');

    const revision = (await callTool(page, 'get_template')).structuredContent?.revision as string;
    const pending = callTool(page, 'add_section', { expectedRevision: revision, type: 'form', note: 'Collect a name' });
    const confirm = page.getByRole('dialog', { name: 'Allow this browser agent action?' });

    await expect(confirm).toBeVisible();
    await expect(confirm.getByText("Agent's note: Collect a name")).toBeVisible();
    await confirm.getByRole('button', { name: "Don't allow" }).click();

    const declined = await pending;
    expect(declined.structuredContent?.code).toBe('user_declined');
    expect((await callTool(page, 'get_template')).structuredContent?.revision).toBe(revision);
  });

  test('turning the agent off removes every tool', async ({ page }) => {
    await openBlankBuilder(page);
    await page.locator('[data-agent-pill]').click();
    await page.getByRole('switch', { name: 'Let browser agents use this builder' }).click();

    await expect.poll(() => toolNames(page)).toEqual([]);
    await expect(page.locator('[data-agent-pill]')).toHaveAttribute('data-agent-pill', 'off');

    // Back on (and the stored choice does not leak into the next test's fresh context).
    await page.getByRole('switch', { name: 'Let browser agents use this builder' }).click();
    await expect.poll(() => toolNames(page)).toEqual(ALL_TOOLS);
  });
});

async function openableSample(page: Page): Promise<string> {
  const listed = await callTool(page, 'list_samples');
  const samples = listed.structuredContent?.samples as Array<{ id: string; openable: boolean }>;

  return samples.find((sample) => sample.openable)?.id ?? '';
}

test.describe('browser agent drawer and consequential tools', () => {
  test('the drawer opens from the pill and its close button closes it, returning focus to the pill', async ({
    page,
  }) => {
    await openBlankBuilder(page);
    const pill = page.locator('[data-agent-pill]');
    await pill.click();
    const drawer = page.getByRole('dialog', { name: 'Browser agent' });

    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('No activity yet')).toBeVisible();
    await expect(drawer.getByRole('switch', { name: 'Let browser agents use this builder' })).toBeVisible();
    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toBeHidden();
    await expect(pill).toBeFocused();
    // The page itself never scrolls behind the drawer.
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);
  });

  test('load_sample asks first: Don’t allow declines, Allow opens the sample', async ({ page }) => {
    await openBlankBuilder(page);
    const id = await openableSample(page);
    const name = page.getByRole('textbox', { name: 'Template name' });
    const before = await name.inputValue();
    const confirm = page.getByRole('dialog', { name: 'Allow this browser agent action?' });

    const declined = callTool(page, 'load_sample', { id, note: 'Start from a sample' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('opens as a new draft');
    await confirm.getByRole('button', { name: "Don't allow" }).click();
    expect((await declined).structuredContent?.code).toBe('user_declined');
    await expect(name).toHaveValue(before);

    const allowed = callTool(page, 'load_sample', { id });
    await confirm.getByRole('button', { name: 'Allow', exact: true }).click();
    const result = await allowed;

    expect(result.isError).toBeUndefined();
    await expect(name).toHaveValue(result.structuredContent?.name as string);
    expect(result.structuredContent?.name).not.toBe(before);
  });

  test('a confirmation stacks over the open drawer and stays clickable', async ({ page }) => {
    await openBlankBuilder(page);
    const id = await openableSample(page);
    await page.locator('[data-agent-pill]').click();
    const drawer = page.getByRole('dialog', { name: 'Browser agent' });
    await expect(drawer).toBeVisible();

    const pending = callTool(page, 'load_sample', { id });
    const confirm = page.getByRole('dialog', { name: 'Allow this browser agent action?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: "Don't allow" }).click();

    expect((await pending).structuredContent?.code).toBe('user_declined');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('listitem').first()).toContainText('Declined');
  });

  test('set_theme and set_format edit the draft as undoable steps', async ({ page }) => {
    await openBlankBuilder(page);
    let revision = (await callTool(page, 'get_template')).structuredContent?.revision as string;
    const themed = await callTool(page, 'set_theme', { expectedRevision: revision, theme: 'midnight' });

    expect(themed.isError).toBeUndefined();
    revision = themed.structuredContent?.revision as string;
    const formatted = await callTool(page, 'set_format', {
      expectedRevision: revision,
      orientation: 'portrait',
      platform: 'tiktok',
    });

    expect(formatted.isError).toBeUndefined();
    const template = await callTool(page, 'get_template');
    expect(template.structuredContent?.orientation).toBe('portrait');
    expect(template.structuredContent?.descriptor).toMatchObject({
      global: { theme: 'midnight', platform: 'tiktok', orientation: 'portrait' },
    });

    await page.keyboard.press('ControlOrMeta+z');
    await expect
      .poll(async () => (await callTool(page, 'get_template')).structuredContent?.orientation)
      .toBe('landscape');
  });

  test('render_preview opens the preview dialog after consent', async ({ page }) => {
    test.skip(process.env.E2E_WASM !== '1', 'needs the WASM render (E2E_WASM=1)');
    await openBlankBuilder(page);
    const pending = callTool(page, 'render_preview');
    const confirm = page.getByRole('dialog', { name: 'Allow this browser agent action?' });
    await expect(confirm).toContainText('placeholder media');
    await confirm.getByRole('button', { name: 'Allow', exact: true }).click();
    const result = await pending;

    expect(result.structuredContent?.status).toBe('done');
    await expect(page.getByRole('dialog').locator('video')).toBeVisible();
    const frames = await callTool(page, 'render_frames', { at: [0.5] });
    const h264 = await page.evaluate(
      () => document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"') !== ''
    );

    // Chromium builds without the H.264 decoder cannot read the preview back; branded Chrome can.
    if (h264) expect(frames.content.some((part) => part.type === 'image')).toBe(true);

    if (!h264) expect(frames.structuredContent?.message).toContain('H.264');
  });
});
