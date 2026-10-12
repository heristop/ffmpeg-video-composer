import { describe, expect, it } from 'vitest';
import { templateService } from './templateService';

// Present Yourself is one template rendered in two formats; the retired portrait variant's id still opens it.
describe('templateService formats', () => {
  it('lists Present Yourself once', async () => {
    const templates = await templateService.getAllTemplates();

    expect(templates.filter((template) => template.name.startsWith('Present Yourself'))).toHaveLength(1);
  });

  it('lists the formats each template composes, for the gallery to pick one', async () => {
    const templates = await templateService.getAllTemplates();

    expect(templates.find((template) => template.id === 'present-yourself')?.formats).toEqual([
      'landscape',
      'portrait',
    ]);
    expect((await templateService.getTemplate('present-yourself', 'portrait'))?.formats).toEqual([
      'landscape',
      'portrait',
    ]);
  });

  it('opens a template in its own format by default', async () => {
    const template = await templateService.getTemplate('present-yourself');

    expect(template?.orientation).toBe('landscape');
    expect(template?.descriptor.global?.orientation).toBe('landscape');
  });

  it('opens a template in the requested format', async () => {
    const template = await templateService.getTemplate('present-yourself', 'portrait');

    expect(template?.id).toBe('present-yourself');
    expect(template?.orientation).toBe('portrait');
    expect(template?.descriptor.global?.orientation).toBe('portrait');
  });

  it('opens the retired portrait id as Present Yourself in portrait', async () => {
    const template = await templateService.getTemplate('present-yourself-portrait');

    expect(template?.id).toBe('present-yourself');
    expect(template?.name).toBe('Present Yourself');
    expect(template?.orientation).toBe('portrait');
  });

  it('still returns null for an unknown id', async () => {
    expect(await templateService.getTemplate('no-such-template')).toBeNull();
  });
});
