import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Seo } from '@/presentation/components/Seo';
import { Loader2 } from '@/presentation/components/icons';
import { ConfirmDialog } from '@/presentation/components/admin/confirm-dialog';
import { TemplateEditorShell } from '@/presentation/components/admin/editor-shell/TemplateEditorShell';
import { TemplateLinkNotice } from '@/presentation/components/admin/editor-shell/template-link-notice';
import { useTemplateLink } from '@/presentation/components/admin/editor-shell/use-template-link';

// Studio entry point for building a custom template from scratch.
// Uses the full template editor with studio-context navigation:
// on save → launches the Builder wizard with the new template.
// on cancel → returns to the Studio gallery.
// A template link (`#t=v1.…`, from `leclap studio` or the MCP open_in_builder tool) opens its template here
// as a new, unsaved draft; the fragment never reaches a server.
export const StudioTemplateBuilderPage = () => {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const link = useTemplateLink();

  return (
    <>
      <Seo title={t('seo.buildFromScratch')} path="/studio/builder" noindex />
      {link.loading ? (
        <div role="status" className="flex min-h-[60vh] items-center justify-center gap-3 text-sm text-foreground/70">
          <Loader2 className="h-6 w-6 animate-spin text-brand-500 motion-reduce:animate-none" aria-hidden />
          {t('link.opening')}
        </div>
      ) : (
        <TemplateEditorShell
          key={link.draft.key}
          initial={link.draft.initial}
          presetsOnStart={link.draft.initial === null && link.outcome?.kind !== 'failed'}
          backLabel={t('nav.studio', { ns: 'common' })}
          onSaved={(saved) => {
            Promise.resolve(navigate(`/studio/new?template=${saved.id}`)).catch(() => {});
          }}
          onCancel={() => {
            Promise.resolve(navigate('/studio')).catch(() => {});
          }}
        />
      )}
      {link.outcome && <TemplateLinkNotice outcome={link.outcome} onDismiss={link.dismiss} />}
      <ConfirmDialog
        open={link.pending}
        tone="primary"
        title={t('link.replaceTitle')}
        description={t('link.replaceBody')}
        cancelLabel={t('link.replaceCancel')}
        confirmLabel={t('link.replaceConfirm')}
        onConfirm={link.confirmReplace}
        onCancel={link.cancelReplace}
      />
    </>
  );
};
