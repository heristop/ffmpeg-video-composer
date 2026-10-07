// Template links on the builder route (`/studio/builder#t=v1.…`): the fragment is decoded into a new,
// unsaved draft, then removed from the address bar so a reload or a shared URL does not reopen it. A link
// pasted while a draft is already open asks first, since opening it replaces that draft.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { readTemplateLinkPayload } from 'ffmpeg-video-composer/src/core/template-link/index.ts';
import { importTemplateLink } from '@/application/usecases/template-link/open-template-link';
import { browserMediaService } from '@/services/browserMediaService';
import type { Template } from '@/services/templateService';
import { createTemplateLinkFlow, type OpenedLink } from './template-link-flow';
import type { TemplateLinkOutcome } from './template-link-notice';

interface Draft {
  // Bumped for every opened link so the editor shell remounts on the new template.
  key: number;
  initial: Template | null;
}

const deps = {
  hasUpload: async (key: string) => (await browserMediaService.getMeta(key)) !== null,
};

export function useTemplateLink() {
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>({ key: 0, initial: null });
  // True until a link present on arrival is decoded, so the shell mounts once, on the linked template.
  const [loading, setLoading] = useState(() => readTemplateLinkPayload(location.hash) !== null);
  const [outcome, setOutcome] = useState<TemplateLinkOutcome | null>(null);
  // A link opened while a draft was already open, waiting for the person to allow replacing that draft.
  const [pending, setPending] = useState<OpenedLink | null>(null);

  const apply = (result: TemplateLinkOutcome & { template?: Template }): void => {
    const template = result.template;

    if (template) setDraft((prev) => ({ key: prev.key + 1, initial: template }));

    setOutcome(result);
  };

  // One flow per mounted page, so StrictMode's second effect run sees the fragment already handled.
  const [flow] = useState(() =>
    createTemplateLinkFlow({
      importLink: (hash) => importTemplateLink(hash, deps),
      navigate,
      onSettled: () => {
        setLoading(false);
      },
      onOpen: apply,
      onPending: setPending,
    })
  );

  useEffect(() => {
    flow.receive(location, loading).catch(() => {});
  }, [flow, location, loading]);

  return {
    draft,
    loading,
    outcome,
    dismiss: () => {
      setOutcome(null);
    },
    pending: pending !== null,
    confirmReplace: () => {
      if (pending) apply(pending);

      setPending(null);
    },
    cancelReplace: () => {
      setPending(null);
    },
  };
}
