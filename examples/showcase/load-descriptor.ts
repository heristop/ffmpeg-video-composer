import fs from 'node:fs/promises';
import path from 'node:path';
import type { TemplateDescriptor } from '../../packages/ffmpeg-video-composer/src/schemas/template.schemas';

/** Build-time preparation shared by preview rendering and packaged sample generation. */
export async function loadDescriptor(
  root: string,
  sample: { source: string; section?: string }
): Promise<TemplateDescriptor> {
  const template: TemplateDescriptor = JSON.parse(await fs.readFile(path.join(root, sample.source), 'utf8'));

  if (sample.section) {
    const section = template.sections?.find((section) => section.name === sample.section);

    if (!section) throw new Error(`Missing scene ${sample.section}`);
    template.sections = [section];
    template.global = { ...template.global, transition: { type: 'cut' } };
  }

  if (!sample.source.startsWith('packages/leclap-creative-kit/')) return template;
  const partialDir = path.join(root, 'packages/leclap-creative-kit/src/partials');
  const refs = new Set(
    template.sections?.filter((section) => section.type === 'partial').map((section) => section.ref)
  );
  const files = (await fs.readdir(partialDir)).filter((file) => file.endsWith('.json') && refs.has(file.slice(0, -5)));
  const bundled = await Promise.all(
    files.map(async (file) => ({
      id: file.slice(0, -5),
      ...JSON.parse(await fs.readFile(path.join(partialDir, file), 'utf8')),
    }))
  );

  if (bundled.length > 0) template.partials = [...bundled, ...(template.partials ?? [])];

  return template;
}
