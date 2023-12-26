import { singleton } from 'tsyringe';
import { TemplateAssets, TemplateDescriptor } from '../types';

@singleton()
class Template {
  public descriptor: TemplateDescriptor;
  public assets: TemplateAssets;

  constructor() {
    this.init();
  }

  init = (): void => {
    this.assets = {
      fonts: {},
      musics: {},
      inputs: [],
    };
  };

  clean = (): void => this.init();
}

export default Template;
