import { appStorage } from './mmkv';
import type { Template } from '@/src/types';

// Storage keys
const TEMPLATES_CACHE_KEY = 'le_clap_templates_cache';
const TEMPLATES_METADATA_KEY = 'le_clap_templates_metadata';

export interface TemplatesCacheMetadata {
  lastUpdated: string;
  version: string;
}

/**
 * Cache templates to local storage (MMKV) for offline access
 */
export const cacheTemplates = async (templates: Template[]): Promise<void> => {
  try {
    const metadata: TemplatesCacheMetadata = {
      lastUpdated: new Date().toISOString(),
      version: '1.0.0',
    };

    await Promise.all([
      appStorage.setItem(TEMPLATES_CACHE_KEY, JSON.stringify(templates)),
      appStorage.setItem(TEMPLATES_METADATA_KEY, JSON.stringify(metadata)),
    ]);
  } catch (error) {
    console.error('Error caching templates:', error);

    throw error;
  }
};

/**
 * Get cached templates from local storage (MMKV)
 */
export const getCachedTemplates = async (): Promise<Template[] | null> => {
  try {
    const cachedData = await appStorage.getItem(TEMPLATES_CACHE_KEY);

    return cachedData ? (JSON.parse(cachedData) as Template[]) : null;
  } catch (error) {
    console.error('Error getting cached templates:', error);

    return null;
  }
};

/**
 * Get templates cache metadata
 */
export const getTemplatesCacheMetadata = async (): Promise<TemplatesCacheMetadata | null> => {
  try {
    const metadata = await appStorage.getItem(TEMPLATES_METADATA_KEY);

    return metadata ? (JSON.parse(metadata) as TemplatesCacheMetadata) : null;
  } catch (error) {
    console.error('Error getting templates cache metadata:', error);

    return null;
  }
};

/**
 * Check if templates cache is stale (older than 24 hours)
 */
export const isTemplatesCacheStale = async (): Promise<boolean> => {
  try {
    const metadata = await getTemplatesCacheMetadata();

    if (!metadata) return true;

    const lastUpdated = new Date(metadata.lastUpdated);
    const now = new Date();
    const hoursDiff = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);

    return hoursDiff > 24; // Stale if older than 24 hours
  } catch (error) {
    console.error('Error checking cache staleness:', error);

    return true;
  }
};
