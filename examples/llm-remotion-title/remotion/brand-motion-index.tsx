import { Composition, registerRoot } from 'remotion';
import { Root } from './Root';
import { BrandMotionPromo } from './BrandMotionPromo';
import { promoDefaults } from './WebAppPromo';

// Root's promo is replaced, while its unchanged title composition remains available.
function BrandMotionRoot() {
  return (
    <>
      <TitleOnly />
      <Composition
        id="LeclapWebAppPromo"
        component={BrandMotionPromo}
        durationInFrames={300}
        fps={30}
        width={1280}
        height={720}
        defaultProps={promoDefaults}
      />
    </>
  );
}
function TitleOnly() {
  // Reuse the existing title defaults without registering the generic promo twice.
  return <Root includePromo={false} />;
}
registerRoot(BrandMotionRoot);
