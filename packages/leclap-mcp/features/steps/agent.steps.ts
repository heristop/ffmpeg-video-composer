import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Given, Then, When } from '@cucumber/cucumber';
import type { AgentWorld } from '../support/world.ts';

const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

interface ComposeOutput {
  outputPath: string;
  durationSeconds: number | null;
  sizeBytes: number;
  videoCodec: string | null;
}

interface ProbeOutput {
  videoCodec: string | null;
}

interface ToolResult {
  structuredContent?: unknown;
  content?: { type: string; text?: string }[];
  isError?: boolean;
}

async function loadJson(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(fixture(name), 'utf8')) as Record<string, unknown>;
}

async function compose(world: AgentWorld): Promise<ComposeOutput> {
  const template = await loadJson('color-card.json');
  const result = (await world.timed('compose_video', (client) =>
    client.callTool({ name: 'compose_video', arguments: { template, locale: 'en' } })
  )) as ToolResult;

  assert.ok(!result.isError, `compose_video failed: ${JSON.stringify(result.content)}`);

  return result.structuredContent as ComposeOutput;
}

// The Before hook spawns the server and connects the client; this step just asserts it is live.
Given('a running leclap MCP server', function (this: AgentWorld) {
  this.requireClient();
});

// --- get_template_schema ------------------------------------------------------------------------
When('the agent requests the template schema', async function (this: AgentWorld) {
  this.lastResult = await this.timed('get_template_schema', (client) =>
    client.callTool({ name: 'get_template_schema', arguments: {} })
  );
});

Then('the schema includes sections', function (this: AgentWorld) {
  const result = this.lastResult as ToolResult;
  const text = result.content?.map((part) => part.text ?? '').join('\n') ?? '';
  assert.ok(text.includes('sections'), 'schema text should mention sections');
});

// --- validate_template --------------------------------------------------------------------------
When('the agent validates a valid inline template', async function (this: AgentWorld) {
  const template = await loadJson('color-card.json');
  this.lastResult = await this.timed('validate_template', (client) =>
    client.callTool({ name: 'validate_template', arguments: { template } })
  );
});

Then('the template is reported valid', function (this: AgentWorld) {
  const result = this.lastResult as ToolResult;
  assert.ok(!result.isError, `validate_template failed: ${JSON.stringify(result.content)}`);
  assert.equal((result.structuredContent as { valid?: boolean }).valid, true);
});

When('the agent validates a malformed inline template', async function (this: AgentWorld) {
  this.lastResult = await this.timed('validate_template:invalid', (client) =>
    client.callTool({ name: 'validate_template', arguments: { template: { sections: 'not-an-array' } } })
  );
});

Then('the call returns an error', function (this: AgentWorld) {
  const result = this.lastResult as ToolResult;
  assert.equal(result.isError, true, 'expected an error result');
});

// --- compose-video prompt -----------------------------------------------------------------------
When('the agent opens the compose-video prompt', async function (this: AgentWorld) {
  this.lastResult = await this.timed('compose-video:prompt', (client) =>
    client.getPrompt({ name: 'compose-video', arguments: {} })
  );
});

Then('it receives a primed authoring message', function (this: AgentWorld) {
  const result = this.lastResult as { messages?: { content?: { type: string; text?: string } }[] };
  const messages = result.messages ?? [];
  assert.ok(messages.length > 0, 'prompt should return at least one message');
  const text = messages.map((m) => m.content?.text ?? '').join('\n');
  assert.ok(text.includes('get_template_schema'), 'prompt should prime the authoring workflow');
});

// --- efficiency ---------------------------------------------------------------------------------
Then('the {string} call ran in under {int} ms', function (this: AgentWorld, tool: string, budgetMs: number) {
  assert.ok(this.lastDurationMs > 0, `${tool} should have a measured duration`);
  assert.ok(
    this.lastDurationMs < budgetMs,
    `${tool} took ${this.lastDurationMs.toFixed(1)}ms, over the ${budgetMs}ms budget`
  );
});

// --- compose_video + probe_media (real render — measured, not budget-asserted) ------------------
When('the agent composes the color-card template', async function (this: AgentWorld) {
  const output = await compose(this);
  this.outputPath = output.outputPath;
  this.lastResult = { structuredContent: output };
});

Then('it receives an output path that exists', async function (this: AgentWorld) {
  assert.ok(this.outputPath, 'compose should return an output path');

  const { size } = await stat(this.outputPath);
  assert.ok(size > 0, 'output mp4 must be larger than 0 bytes');
});

Then('the render has a positive duration and non-zero size', function (this: AgentWorld) {
  const result = this.lastResult as ToolResult;
  const output = result.structuredContent as ComposeOutput;

  assert.ok((output.durationSeconds ?? 0) > 0, 'duration must be positive');
  assert.ok(output.sizeBytes > 0, 'size must be non-zero');
});

// Filter types reach FFmpeg verbatim, so an unknown one passes validation and the descriptor guard and
// only fails once the engine renders the segment.
When('the agent composes a template whose filter FFmpeg rejects', async function (this: AgentWorld) {
  const template = await loadJson('unknown-filter.json');
  this.lastResult = await this.timed('compose_video:failed', (client) =>
    client.callTool({ name: 'compose_video', arguments: { template, locale: 'en' } })
  );
});

// The worker's log tail follows the first line and holds the engine's own log of the failure either way,
// so only the first line shows whether the reason made it into the error itself.
Then('the error leads with the reason the engine gave', function (this: AgentWorld) {
  const result = this.lastResult as ToolResult;
  const text = result.content?.map((part) => part.text ?? '').join('\n') ?? '';

  assert.equal(text.split('\n')[0], 'FFmpeg command failed');
});

When('the agent probes the rendered file', async function (this: AgentWorld) {
  assert.ok(this.outputPath, 'a rendered file is required before probing');

  this.lastResult = await this.timed('probe_media', (client) =>
    client.callTool({ name: 'probe_media', arguments: { path: this.outputPath } })
  );
});

Then('it reports a video codec', function (this: AgentWorld) {
  const result = this.lastResult as ToolResult;

  assert.ok(!result.isError, `probe_media failed: ${JSON.stringify(result.content)}`);

  const output = result.structuredContent as ProbeOutput;
  assert.ok(output.videoCodec, 'probe should report a video codec');
});
