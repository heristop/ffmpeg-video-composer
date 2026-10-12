type PreviewForm = {
  sections: Array<{
    type: string;
    options?: { fields?: Array<{ name: string; label?: { en?: string }; maxLength?: number }> };
  }>;
};

export function fieldsFor(template: PreviewForm, defaults: Record<string, string>): Record<string, string> {
  const fields = { ...defaults };

  for (const section of template.sections.filter((section) => section.type === 'form')) {
    for (const field of section.options?.fields ?? []) {
      fields[field.name] ??= (field.label?.en ?? 'Your next story').slice(0, Math.min(field.maxLength ?? 32, 32));
    }
  }

  return fields;
}

export function videoFor(orientation: string | undefined, index: number): string {
  if (orientation === 'portrait') return 'video_portrait.mp4';

  return index % 2 ? 'video_2.mp4' : 'video_1.mp4';
}

const SAMPLE_VIDEOS: Record<string, string> = {
  'product-launch': 'examples/showcase/media/moo-mug.mp4',
  'web-app-promo': 'examples/showcase/media/leclap-canvas.mp4',
};

export function bundledVideoFor(sampleId: string): string | undefined {
  return SAMPLE_VIDEOS[sampleId];
}

// The evidence templates' defaults are placeholders; their previews fill them with copy that matches the
// demo shop's before/after walk (examples/agentic-pr-video/demo-shop).
const EVIDENCE_COPY: Record<string, Record<string, string>> = {
  'pr-evidence': {
    project: 'Kiln & Co. shop',
    ticket: 'SHOP-123',
    change: 'Add to cart opens the cart',
    reviewFocus: 'The button, then the cart drawer',
  },
  'before-after': {
    project: 'Kiln & Co. shop',
    ticket: 'SHOP-123',
    change: 'Make add to cart obvious',
    beforeCaption: 'A faint link, no feedback',
    afterCaption: 'One button, then the cart',
    reviewFocus: 'Button contrast, then the drawer',
  },
};

export function evidenceCopyFor(sampleId: string): Record<string, string> {
  return EVIDENCE_COPY[sampleId] ?? {};
}
