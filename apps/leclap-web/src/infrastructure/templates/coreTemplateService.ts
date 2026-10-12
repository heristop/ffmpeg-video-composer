// Core package template loading service
import { templateLogger } from '@/lib/logger';
// The catalog is authored once in @leclap/creative-kit and consumed by web + expo + the MCP catalog.
// Legacy web-only demo templates were removed.
import { APP_TEMPLATES, findAppTemplate, type AppTemplate, type TemplateOrientation } from '@leclap/creative-kit';

type Translation = Record<string, string | undefined>;
type Variables = Record<string, string | string[]>;
type Field = { name: string; maxLength: number; label: Translation };
type FilterValues = {
  h?: number | string;
  w?: number | string;
  x?: number | string;
  y?: number | string;
  c?: string;
  t?: string | number;
  text?: Translation;
  fontcolor?: string;
  fontsize?: number | string;
  fontfile?: string;
  alpha?: string;
  d?: string;
  st?: string;
  color?: string;
  box?: number;
  boxcolor?: string;
  boxborderw?: number;
};
type SectionFilter = { type: string; value?: string | number; values?: FilterValues; range?: string };
type SectionOptions = { duration?: number; fields?: Field[]; forceAspectRatio?: boolean; [key: string]: unknown };
type TemplateSection = {
  name: string;
  type: string;
  options?: SectionOptions;
  filters?: SectionFilter[];
  title?: Translation;
  description?: Translation;
};
type TemplateDescriptorGlobal = {
  variables?: Variables;
  orientation?: string;
  colorsList?: string[];
  musicEnabled?: boolean;
  transition?: { type: string; duration?: number };
  audio?: {
    sourceVolume?: number;
    musicVolume?: number;
    normalize?: 'loudnorm' | 'dynaudnorm';
    ducking?: boolean | object;
  };
};
interface TemplateDescriptor {
  global?: TemplateDescriptorGlobal;
  sections?: TemplateSection[];
}

export interface CoreTemplate {
  id: string;
  name: string;
  description: string;
  category: 'sample' | 'video' | 'portrait' | 'advanced' | 'demo';
  complexity: 'simple' | 'intermediate' | 'advanced';
  orientation: TemplateOrientation;
  // Every format the template composes (its own orientation included).
  formats: TemplateOrientation[];
  hasForm: boolean;
  templateDescriptor: TemplateDescriptor;
  previewImage?: string;
}

// A shared app template, mapped into the web CoreTemplate shape.
const toCoreTemplate = (t: AppTemplate): CoreTemplate => ({
  id: t.id,
  name: t.name,
  description: t.description,
  category: t.category,
  complexity: t.complexity,
  orientation: t.orientation,
  formats: t.formats,
  hasForm: t.hasForm,
  templateDescriptor: t.descriptor as unknown as TemplateDescriptor,
});

// The catalog is the shared app-template list, each template in its own format.
const TEMPLATE_SOURCES: CoreTemplate[] = APP_TEMPLATES.map(toCoreTemplate);

const CORE_TEMPLATES: Record<string, CoreTemplate | undefined> = Object.fromEntries(
  TEMPLATE_SOURCES.map((template) => [template.id, template])
);

class CoreTemplateService {
  async getTemplates(): Promise<CoreTemplate[]> {
    try {
      templateLogger.log('Loading core templates');

      return Object.values(CORE_TEMPLATES).filter((t): t is CoreTemplate => t !== undefined);
    } catch (error) {
      templateLogger.error('Failed to load templates:', error);

      throw new Error(`Failed to load core templates: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // `format` picks one of the formats the template composes; without it a retired variant's id (e.g.
  // `present-yourself-portrait`, saved projects and links) opens the merged template in that variant's format.
  async getTemplate(id: string, format?: TemplateOrientation): Promise<CoreTemplate | null> {
    const found = findAppTemplate(id, format);

    if (!found) {
      templateLogger.warn(`Template not found: ${id}`);

      return null;
    }

    templateLogger.log(`Loading template: ${found.name} (${found.orientation})`);

    return toCoreTemplate(found);
  }

  async getTemplatesByCategory(category: CoreTemplate['category']): Promise<CoreTemplate[]> {
    const templates = Object.values(CORE_TEMPLATES).filter(
      (template): template is CoreTemplate => template?.category === category
    );
    templateLogger.log(`Found ${templates.length} templates in category: ${category}`);

    return templates;
  }

  getAvailableCategories(): CoreTemplate['category'][] {
    return ['sample', 'video', 'portrait', 'advanced', 'demo'];
  }

  // Stub for loading templates from the core package's JSON files.
  async loadTemplateFromFile(templatePath: string): Promise<TemplateDescriptor> {
    try {
      templateLogger.log(`Would load template from: ${templatePath}`);

      throw new Error('File-based template loading not yet implemented');
    } catch (error) {
      throw new Error(`Failed to load template from file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export const coreTemplateService = new CoreTemplateService();
export default CoreTemplateService;
