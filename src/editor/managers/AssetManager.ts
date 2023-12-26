import { inject, singleton } from 'tsyringe';
import AbstractLogger from '../../platform/logging/AbstractLogger';
import AbstractFilesystem from '../../platform/filesystem/AbstractFilesystem';
import { Media, MapAnimationInput } from '@/core/types';
import Template from '../../core/models/Template';
import Segment from '../../core/models/Segment';
import VariableManager from './VariableManager';

@singleton()
class AssetManager {
  constructor(
    private readonly template: Template,
    private readonly variableManager: VariableManager,

    public segment: Segment,

    @inject('logger') private readonly logger: AbstractLogger,
    @inject('filesystemAdapter') private readonly filesystemAdapter: AbstractFilesystem
  ) {}

  async setUpPaths(): Promise<void> {
    this.segment.assetsDir = await this.filesystemAdapter.getBuildPath('assets');
    this.segment.fontsDir = await this.filesystemAdapter.getBuildPath('fonts');
    this.segment.animationsDir = await this.filesystemAdapter.getBuildPath('animations');
  }

  prepareAssets = (): void => {
    for (const key in this.segment.currentSection.options) {
      if (Object.hasOwnProperty.call(this.segment.currentSection.options, key) && key.endsWith('Url')) {
        this.segment.currentSection.inputs = this.segment.currentSection.inputs.concat({
          name: this.segment.currentSection.name,
          url: this.segment.currentSection.options[key],
        });
      }
    }
  };

  fetchAssets = async (): Promise<void> => {
    this.prepareAssets();

    try {
      await Promise.all(
        this.segment.currentSection.inputs.map(async (item: MapAnimationInput) => {
          if (!this.template.assets.inputs[item.name]) {
            if (!item.url) {
              // If no url filled, use variables
              item.url = `{{ ${item.name} }}`;
            }

            // Map variables
            item.url = this.variableManager.mapVariables(item.url);

            // Check url format
            if (!/^http/.exec(item.url)) {
              throw new Error(
                `[${this.segment.currentSection.name}][Assets] Url for ${item.name} is not valid: ${item.url}`
              );
            }

            if (item.type === 'frame' && new RegExp('(.*?).(zip)$').test(item.url)) {
              // Process zip animation
              await this.fetchAndUnzipAnimation(item);
            } else if (item.type === 'frame' && item.options && item.options.frames) {
              // Process png animation
              for (let i = 1; i <= item.options.frames; i++) {
                await this.fetchMedia(item, i);
              }
            } else {
              // Process single media
              await this.fetchMedia(item);
            }
          }

          this.logger.info(`[${this.segment.currentSection.name}][Assets] ${item.name}`);
        })
      );
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  };

  fetchFonts = async (): Promise<void> => {
    for (let i = 0; i < this.segment.tempFonts.length; i++) {
      const fontFile = this.segment.tempFonts[i];
      const fontFamily = fontFile.split('-')[0].split('.')[0];
      const targetPath = `${this.segment.fontsDir}/${fontFile}`;

      const url = `https://fonts.googleapis.com/css?family=${fontFamily}`;
      this.logger.info(`[${this.segment.currentSection.name}][Font] fetching ${url}`);

      const cssContent = await this.filesystemAdapter.fetchAndRead(url);
      const fontUrl = this.extractFontUrlFromCSS(cssContent as string);

      this.logger.info(`[${this.segment.currentSection.name}][Font] fetching ${fontUrl}`);

      const path = await this.filesystemAdapter.fetch(fontUrl);

      await this.filesystemAdapter.move(path as string, targetPath);
    }
  };

  private extractFontUrlFromCSS = (cssContent: string): string | null => {
    const regex = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/;
    const match = cssContent.match(regex);

    return match ? match[1] : null;
  };

  fetchAndUnzipAnimation = async (media: Media): Promise<void> => {
    // Fetch zip file
    await this.fetchMedia(media);

    const targetPath = `${this.segment.animationsDir}/${media.name}`;

    if (!this.template.assets.inputs[media.name]) {
      const url = this.template.assets.inputs[media.url];

      const framesList = await this.filesystemAdapter.unzip(url, targetPath);

      if (!this.template.assets.inputs[media.name]) {
        this.template.assets.inputs[media.name] = [];
      }

      for (let i = 0; i < framesList.length; i++) {
        this.template.assets.inputs[media.name].push(framesList[i]);
      }
    }
  };

  fetchMedia = async (media: Media, frame = 0): Promise<void> => {
    const { name, url, extension } = this.extractFromMedia(media, frame);

    if (!this.template.assets.inputs[url]) {
      this.logger.info(`[${this.segment.currentSection.name}][Media] fetching asset ${name}`);

      const path = await this.filesystemAdapter.fetch(url);
      const targetPath = `${this.segment.assetsDir}/${name}.${extension}`;

      await this.filesystemAdapter.move(path as string, targetPath);

      this.template.assets.inputs[url] = targetPath;
      this.logger.info(`[${this.segment.currentSection.name}][Media] fetched asset ${name}`);
    }
  };

  fetchCachedMedia = (media: Media, frame = 0): string => {
    const { name, url } = this.extractFromMedia(media, frame);

    if (this.template.assets.inputs[url]) {
      return this.template.assets.inputs[url];
    }

    if (this.template.assets.inputs[name]) {
      return this.template.assets.inputs[name];
    }

    throw new Error(`No cache found for keys ${url}, ${name}`);
  };

  extractFromMedia = (media: Media, frame = 0): Media => {
    const extension = this.getExtensionFromUrl(media.url);
    let url = this.variableManager.mapVariables(media.url);
    let name = this.generateName(media, url, frame);

    url = this.replaceFrameInUrl(url, frame);
    name = this.replaceFrameInName(name, frame);

    return { name, url, extension };
  };

  private getExtensionFromUrl = (url: string): string => {
    return url.split('.').pop() || '';
  };

  private generateName = (media: Media, url: string, frame: number): string => {
    if (frame || !media.name) {
      return url
        .substring(url.lastIndexOf('/') + 1)
        .split('.')
        .slice(0, -1)
        .join('.');
    }

    return media.name;
  };

  private replaceFrameInUrl = (url: string, frame: number): string => {
    if (frame && /%d/.test(url)) {
      const framePattern = /-([0-9]{3}).([a-z]{3})$/;
      const frameString = `00${frame}`.slice(-3);

      return framePattern.test(url) ? url.replace('%d', frameString) : url.replace('%d', `${frame}`);
    }

    return url;
  };

  private replaceFrameInName = (name: string, frame: number): string => {
    return frame ? name.replace('%d', `00${frame}`.slice(-3)) : name;
  };
}

export default AssetManager;
