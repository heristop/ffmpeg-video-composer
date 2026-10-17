import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { templateService, type Template } from '@/services/templateService';
import { userTemplateService } from '@/services/userTemplateService';
import { templateToPartial } from '@/lib/templateToPartial';
import { logger } from '@/lib/logger';
import { recentFirst } from './template-library.logic';

export type SamplesStatus = 'loading' | 'ready' | 'error';

const isSample = (template: Template): boolean => template.source === 'sample';

// The template library's data. The author's own templates are read synchronously from this browser,
// most recent first, so they paint on the first frame instead of flashing the empty shelf while the
// samples load; the samples are fetched, with a retry. Row actions navigate where they lead.
export function useTemplateLibrary() {
  const navigate = useNavigate();
  const { t } = useTranslation('admin');
  const [mine, setMine] = useState(() => recentFirst(userTemplateService.list()));
  const [samples, setSamples] = useState<Template[]>([]);
  const [loadState, setLoadState] = useState<{ attempt: number; status: SamplesStatus }>({
    attempt: 0,
    status: 'loading',
  });
  const [attempt, setAttempt] = useState(0);
  const status = loadState.attempt === attempt ? loadState.status : 'loading';

  useEffect(() => {
    let live = true;
    templateService
      .getAllTemplates()
      .then((all) => {
        if (!live) return;
        setSamples(all.filter(isSample));
        setLoadState({ attempt, status: 'ready' });
      })
      .catch((error: unknown) => {
        logger.error('Failed to load templates', error);

        if (live) setLoadState({ attempt, status: 'error' });
      });

    return () => {
      live = false;
    };
  }, [attempt]);

  const duplicate = (template: Template): void => {
    try {
      const copy = userTemplateService.duplicate(template, t('card.copyName', { name: template.name }));
      Promise.resolve(navigate(`/templates/${copy.id}/edit`)).catch(() => {});
    } catch (error) {
      logger.error('Duplicate failed', error);
    }
  };

  const remove = (template: Template): void => {
    userTemplateService.remove(template.id);
    setMine(recentFirst(userTemplateService.list()));
  };

  const convertToPartial = (template: Template): void => {
    Promise.resolve(navigate('/partials', { state: { partialDraft: templateToPartial(template) } })).catch(() => {});
  };

  return {
    mine,
    samples,
    status,
    retry: () => {
      setAttempt((count) => count + 1);
    },
    duplicate,
    remove,
    convertToPartial,
  };
}
