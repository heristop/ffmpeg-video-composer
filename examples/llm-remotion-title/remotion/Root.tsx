import { Composition } from 'remotion';
import { EditorialType, editorialDefaults } from './EditorialType';
import { ProductReveal, productRevealDefaults } from './ProductReveal';
import { Title } from './Title';
import { WebAppPromo, promoDefaults } from './WebAppPromo';

export function Root({ includePromo = true }: { includePromo?: boolean }) {
  return (
    <>
      <Composition
        id="LeclapEditorialType"
        component={EditorialType}
        durationInFrames={300}
        fps={30}
        width={1280}
        height={720}
        defaultProps={editorialDefaults}
      />
      <Composition
        id="LeclapProductReveal"
        component={ProductReveal}
        durationInFrames={300}
        fps={30}
        width={1280}
        height={720}
        defaultProps={productRevealDefaults}
      />
      <Composition
        id="LeclapTitle"
        component={Title}
        durationInFrames={300}
        fps={30}
        width={1280}
        height={720}
        defaultProps={{
          headline: 'LECLAP',
          headlineY: 320,
          logoDelayFrames: 15,
          entranceDurationFrames: 24,
          springDamping: 18,
          background: 'background.mp4',
          logo: 'logo.png',
          font: 'font.ttf',
        }}
      />
      {includePromo && (
        <Composition
          id="LeclapWebAppPromo"
          component={WebAppPromo}
          durationInFrames={300}
          fps={30}
          width={1280}
          height={720}
          defaultProps={promoDefaults}
        />
      )}
    </>
  );
}
