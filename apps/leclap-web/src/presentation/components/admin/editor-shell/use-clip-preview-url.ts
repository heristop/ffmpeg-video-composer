// Resolve an asset-backed clip section's MediaChoice to a playable preview URL for the WYSIWYG
// canvas: pasted URLs play directly, uploads resolve to a transient object URL (revoked on change /
// unmount), library ids have no browser-side copy (there is no curated video library yet).
import { useEffect, useState } from 'react';
import { browserMediaService } from '@/services/browserMediaService';
import type { MediaChoice } from '../templateEditorModel';

export function useClipPreviewUrl(choice: MediaChoice | undefined): string | undefined {
  const direct = choice?.source === 'url' ? choice.url : undefined;
  const uploadKey = choice?.source === 'upload' ? choice.key : undefined;
  const [upload, setUpload] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!uploadKey) return () => {};

    let objectUrl: string | null = null;
    let cancelled = false;

    browserMediaService
      .previewUrl(uploadKey)
      .then((url) => {
        if (!url) return;

        if (cancelled) {
          URL.revokeObjectURL(url);

          return;
        }

        objectUrl = url;
        setUpload({ key: uploadKey, url });
      })
      .catch(() => {});

    return () => {
      cancelled = true;

      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uploadKey]);

  return direct ?? (upload && upload.key === uploadKey ? upload.url : undefined);
}
