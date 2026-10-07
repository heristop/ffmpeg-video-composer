// The live effect preview, loaded on first use: the engine plans it draws from (fx primitives, stroke
// plans, sprite shapes) stay out of the builder's eager bundle.
import { lazy, Suspense } from 'react';
import type { FxPreviewLayerProps } from './FxPreviewLayer';

const FxPreviewLayer = lazy(() => import('./FxPreviewLayer'));

export type { FxPreviewLayerProps } from './FxPreviewLayer';
export type { PreviewEnv } from './fx-context';

export const LazyFxPreview = (props: FxPreviewLayerProps) => (
  <Suspense fallback={null}>
    <FxPreviewLayer {...props} />
  </Suspense>
);
