// Re-export from core package for consistency
export type { TemplateDescriptor } from 'ffmpeg-video-composer/src/core/types.d.ts';
export type { QualityTier } from 'ffmpeg-video-composer/src/core/encoding.ts';
import { coreTemplateService, type CoreTemplate } from '@/infrastructure/templates/coreTemplateService';
import type { TemplateOrientation } from '@leclap/creative-kit';
import type { TemplateDescriptor } from 'ffmpeg-video-composer/src/core/types.d.ts';
import { userTemplateService } from '@/services/userTemplateService';
import { materializeTemplatePartials } from '@/services/templatePartialService';
import { templateLogger } from '@/lib/logger';
import { TEMPLATE_INPUTS_SECTION, TEMPLATE_INPUTS_TITLE, templateInputFields } from '@/services/template-inputs';

export interface Template {
  id: string;
  name: string;
  description: string;
  orientation: TemplateOrientation;
  hasForm: boolean;
  complexity: 'simple' | 'intermediate' | 'advanced';
  // 'sample' = built-in template; 'user' = created by the user (localStorage).
  source: 'sample' | 'user';
  descriptor: TemplateDescriptor;
}

export type Translation = Record<string, string | undefined>;

export interface FormFieldShape {
  name: string;
  label: Record<string, string>;
  maxLength?: number;
  type?: string;
}

// One input section of a template, in template order. `clip` carries `clipIndex` (its 0-based
// position among project_video sections); `form` uses -1.
export interface InputSection {
  name: string;
  kind: 'form' | 'clip';
  clipIndex: number;
  title?: Translation;
  description?: Translation;
}

const getServerUrl = () => {
  // Configured at build time via VITE_API_URL; falls back to the local dev server.
  return import.meta.env.VITE_API_URL ?? 'http://localhost:8082';
};

class TemplateService {
  private readonly serverUrl = getServerUrl();
  private readonly templatesCache = new Map<string, TemplateDescriptor>();

  private materializeForRead(template: TemplateDescriptor): TemplateDescriptor {
    try {
      return materializeTemplatePartials(template);
    } catch (error) {
      templateLogger.warn('Could not expand template partials:', error);

      return template;
    }
  }

  private convertCoreTemplate(coreTemplate: CoreTemplate): Template {
    const template: Template = {
      id: coreTemplate.id,
      name: coreTemplate.name,
      description: coreTemplate.description,
      orientation: coreTemplate.orientation,
      hasForm: coreTemplate.hasForm,
      complexity: coreTemplate.complexity,
      source: 'sample',
      descriptor: coreTemplate.templateDescriptor,
    };
    this.templatesCache.set(coreTemplate.id, coreTemplate.templateDescriptor);

    return template;
  }

  async getAllTemplates(): Promise<Template[]> {
    try {
      templateLogger.log('Loading core templates');

      const coreTemplates = await coreTemplateService.getTemplates();
      const templates: Template[] = coreTemplates.map((ct) => this.convertCoreTemplate(ct));

      // Append user-created templates (localStorage) so they sit alongside samples.
      templates.push(...userTemplateService.list());

      templateLogger.success(`Loaded ${templates.length} templates`);

      return templates;
    } catch (error) {
      templateLogger.error('Failed to load templates:', error);

      throw new Error(`Failed to load templates: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getTemplate(templateId: string): Promise<Template | null> {
    // User-created templates (localStorage) take precedence and carry their own descriptor.
    const userTemplate = userTemplateService.get(templateId);

    if (userTemplate) {
      return userTemplate;
    }

    try {
      const coreTemplate = await coreTemplateService.getTemplate(templateId);

      if (!coreTemplate) {
        return null;
      }

      return {
        id: coreTemplate.id,
        name: coreTemplate.name,
        description: coreTemplate.description,
        orientation: coreTemplate.orientation,
        hasForm: coreTemplate.hasForm,
        complexity: coreTemplate.complexity,
        source: 'sample',
        descriptor: coreTemplate.templateDescriptor,
      };
    } catch (error) {
      templateLogger.error(`Failed to get template ${templateId}:`, error);

      return null;
    }
  }

  extractFormFields(template: TemplateDescriptor): Array<{
    name: string;
    label: Record<string, string>;
    maxLength?: number;
    type?: string;
  }> {
    const formFields: Array<{
      name: string;
      label: Record<string, string>;
      maxLength?: number;
      type?: string;
    }> = [];

    for (const section of this.materializeForRead(template).sections ?? []) {
      if (section.type === 'form' && section.options?.fields) {
        // Core's Field.label is a Translation (values may be undefined); the
        // consumers here only read field names/length, so coerce the shape.
        formFields.push(...(section.options.fields as unknown as typeof formFields));
      }
    }

    return formFields;
  }

  // Fields of ONE form section (by section name) — for the per-section form step in the wizard.
  extractFormFieldsForSection(template: TemplateDescriptor, sectionName: string): FormFieldShape[] {
    if (sectionName === TEMPLATE_INPUTS_SECTION) return templateInputFields(this.materializeForRead(template));

    const section = (this.materializeForRead(template).sections ?? []).find((s) => s.name === sectionName);

    if (section?.type !== 'form' || !section.options?.fields) {
      return [];
    }

    return section.options.fields as unknown as FormFieldShape[];
  }

  // The template's INPUT sections (form + project_video) in template order — drives the
  // section-by-section wizard (both linear and hub). Each clip carries `clipIndex`, its 0-based
  // position among project_video sections (forms get -1). Declared global.fields no form asks for come
  // first, as the synthetic "Template inputs" form (services/template-inputs.ts).
  orderedInputSections(template: TemplateDescriptor): InputSection[] {
    const materialized = this.materializeForRead(template);
    const out: InputSection[] =
      templateInputFields(materialized).length > 0
        ? [{ name: TEMPLATE_INPUTS_SECTION, kind: 'form', clipIndex: -1, title: TEMPLATE_INPUTS_TITLE }]
        : [];
    let clipIndex = 0;

    for (const section of (materialized.sections ?? []) as Array<{
      name: string;
      type: string;
      title?: Translation;
      description?: Translation;
    }>) {
      if (section.type === 'form') {
        out.push({
          name: section.name,
          kind: 'form',
          clipIndex: -1,
          title: section.title,
          description: section.description,
        });
        continue;
      }

      if (section.type === 'project_video') {
        out.push({
          name: section.name,
          kind: 'clip',
          clipIndex,
          title: section.title,
          description: section.description,
        });
        clipIndex += 1;
      }
    }

    return out;
  }

  getTemplateComplexity(template: TemplateDescriptor): 'simple' | 'intermediate' | 'advanced' {
    const materialized = this.materializeForRead(template);
    // Single pass over the sections instead of three separate traversals.
    let formSections = 0;
    let videoSections = 0;
    let totalFilters = 0;

    for (const section of materialized.sections ?? []) {
      if (section.type === 'form') formSections++;

      if (section.type === 'project_video') videoSections++;

      totalFilters += section.filters?.length ?? 0;
    }

    if (formSections > 2 || totalFilters > 15) return 'advanced';

    if (formSections > 0 || videoSections > 1 || totalFilters > 5) return 'intermediate';

    return 'simple';
  }

  // Test server connection
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/health`);

      return response.ok;
    } catch (error) {
      templateLogger.error('Server connection test failed:', error);

      return false;
    }
  }

  getServerUrl(): string {
    return this.serverUrl;
  }
}

export const templateService = new TemplateService();
