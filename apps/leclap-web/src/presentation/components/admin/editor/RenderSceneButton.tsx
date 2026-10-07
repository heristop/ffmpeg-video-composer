// "Render this scene" in the effect panel: the exact engine look of the selected scene alone, through the
// builder's preview render (WASM, placeholder media, ultrafast), when the live canvas approximation is not
// enough. Hidden where no shell provides the render.
import { useTranslation } from 'react-i18next';
import { Clapperboard } from '@/presentation/components/icons';
import { Button } from '@/presentation/components/ui';
import { useSceneRender } from './scene-render-context';

export const RenderSceneButton = () => {
  const { t } = useTranslation('admin');
  const scene = useSceneRender();

  if (!scene) return null;

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={scene.render}
      disabled={scene.rendering}
      title={t('animation.fx.renderSceneHint')}
      className="h-8 w-full rounded-lg text-xs"
    >
      <Clapperboard className="size-3.5" />
      {scene.rendering ? t('testRender.rendering') : t('animation.fx.renderScene')}
    </Button>
  );
};
