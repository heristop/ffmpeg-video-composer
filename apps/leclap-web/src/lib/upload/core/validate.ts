import { matches } from './accept';
import type { AcceptSpec, Rejection, RejectionCode } from './types';

export interface ValidateOptions {
  accept?: AcceptSpec;
  /** Bytes. */
  maxSize?: number;
  /** How many more files may be accepted. 0 means none — unlike react-dropzone, which read <1 as Infinity. */
  remaining?: number;
  /**
   * Whether the surface takes more than one file. `false` caps the batch at one here, not just on
   * the `<input multiple>` attribute — a drop bypasses the input, so the attribute alone would let
   * a `multiple: false` consumer receive five files.
   */
  multiple?: boolean;
}

export interface ValidateResult {
  accepted: File[];
  rejections: Rejection[];
}

// Messages are developer-facing only; the UI translates from `code` via the upload.* i18n keys.
const MESSAGE: Record<RejectionCode, string> = {
  'file-too-large': 'File is larger than the permitted size',
  'file-invalid-type': 'File type is not accepted',
  'too-many-files': 'Too many files',
};

const reject = (file: File, codes: RejectionCode[]): Rejection => ({
  file,
  errors: codes.map((code) => ({ code, message: MESSAGE[code] })),
});

function fileRejectionCodes(file: File, accept: AcceptSpec, maxSize: number | undefined): RejectionCode[] {
  const codes: RejectionCode[] = [];

  if (!matches(file, accept)) codes.push('file-invalid-type');

  if (maxSize !== undefined && file.size > maxSize) codes.push('file-too-large');

  return codes;
}

export const validateFiles = (files: File[], options: ValidateOptions = {}): ValidateResult => {
  const { accept = [], maxSize, remaining, multiple } = options;
  // The stricter of the two caps wins, and an explicit `remaining: 0` still means zero.
  const cap = Math.min(remaining ?? Infinity, multiple === false ? 1 : Infinity);
  const accepted: File[] = [];
  const rejections: Rejection[] = [];

  for (const file of files) {
    const codes = fileRejectionCodes(file, accept, maxSize);

    if (codes.length > 0) {
      rejections.push(reject(file, codes));
      continue;
    }

    if (accepted.length >= cap) {
      rejections.push(reject(file, ['too-many-files']));
      continue;
    }

    accepted.push(file);
  }

  return { accepted, rejections };
};
