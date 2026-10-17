import { useEffect, useState } from 'react';
import { findBackground } from '@/data/mediaCatalog';
import { browserMediaService } from '@/services/browserMediaService';
import type { MediaChoice } from '../templateEditorModel';

// Resolve a MediaChoice to a previewable URL for the placement canvas: library → curated url, pasted
// url → as-is, upload → a transient object URL read back from IndexedDB (revoked when the choice changes).
export function useChoicePreviewUrl(choice: MediaChoice | undefined): string {
  let directUrl = '';

  if (choice?.source === 'library') directUrl = findBackground(choice.id)?.url ?? '';

  if (choice?.source === 'url') directUrl = choice.url;
  const uploadKey = choice?.source === 'upload' ? choice.key : undefined;
  const [upload, setUpload] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!uploadKey) return () => {};

    let objectUrl = '';
    let cancelled = false;

    browserMediaService
      .getBytes(uploadKey)
      .then((bytes) => {
        if (!bytes || cancelled) return;

        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
        setUpload({ key: uploadKey, url: objectUrl });
      })
      .catch(() => {});

    return () => {
      cancelled = true;

      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uploadKey]);

  return directUrl || (upload && upload.key === uploadKey ? upload.url : '');
}
