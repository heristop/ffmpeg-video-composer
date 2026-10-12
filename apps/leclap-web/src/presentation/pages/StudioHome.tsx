import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StudioSurface } from '@/presentation/components/StudioSurface';
import { KineticHeading } from '@/presentation/components/kinetic';
import { TemplateSelector } from '@/presentation/components/TemplateSelector';
import { BrowserCompatibility } from '@/presentation/components/BrowserCompatibility';
import { ProjectsShelf } from '@/presentation/components/projects/projects-shelf';
import { Seo } from '@/presentation/components/Seo';
import { templateService, type Template } from '@/services/templateService';
import { studioPick } from '@/presentation/pages/studio-pick';

// The studio home: the saved projects, then the template gallery, on a dark app surface — where a video
// starts and where it's picked up again. Picking a template navigates to the editor
// (`/studio/new?template=<id>`) with a View Transition; TemplateSelector tags the clicked card's title
// so it morphs into the editor titlebar. For that morph to land, the editor title has to exist in
// the very next frame — so we (a) warm the lazy editor chunk and (b) hand the full template through nav
// state, letting the editor render its titlebar synchronously instead of after an async fetch. A template
// composed for several formats opens in the device's (studio-pick.ts): portrait on a phone held upright.
export const StudioHome = () => {
  const { t } = useTranslation('builder');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Old project links pointed at `/studio?projectId=…[&edit=1]`; the editor now lives at /studio/new.
  if (searchParams.get('projectId')) {
    return <Navigate to={`/studio/new?${searchParams.toString()}`} replace />;
  }

  const onTemplateSelected = (template: Template) => {
    const pick = studioPick(template, { width: window.innerWidth, height: window.innerHeight });
    const picked = pick.format ? templateService.getTemplate(template.id, pick.format) : Promise.resolve(template);

    // Await the editor chunk so the route renders synchronously inside the transition (a lazy Suspense
    // fallback would otherwise be the snapshot the morph captures — i.e. no title to morph into).
    Promise.all([picked, import('@/presentation/pages/Builder')])
      .then(([opened]) => navigate(pick.href, { viewTransition: true, state: { template: opened ?? template } }))
      .catch(() => {});
  };

  const onBuildFromScratch = () => {
    Promise.resolve(navigate('/studio/builder')).catch(() => {});
  };

  return (
    <StudioSurface
      kicker={t('studio.home.kicker')}
      title={t('studio.home.title')}
      subtitle={t('studio.home.subtitle')}
      titleSlot={<KineticHeading text={t('studio.home.title')} level="l" as="h1" uppercase />}
    >
      <Seo
        title={t('studio.title', { ns: 'seo' })}
        description={t('studio.description', { ns: 'seo' })}
        path="/studio"
      />
      <BrowserCompatibility />
      <ProjectsShelf />
      <TemplateSelector
        selectedTemplate={null}
        onTemplateSelected={onTemplateSelected}
        onBuildFromScratch={onBuildFromScratch}
      />
    </StudioSurface>
  );
};
