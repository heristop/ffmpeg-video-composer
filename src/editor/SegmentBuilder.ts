import { autoInjectable, inject } from 'tsyringe';
import AbstractLogger from '../platform/logging/AbstractLogger';
import AbstractFilesystem from '../platform/filesystem/AbstractFilesystem';
import { MapAnimationInput, Section } from '@/core/types';
import Template from '../core/models/Template';
import Project from '../core/models/Project';
import Segment from '../core/models/Segment';
import AssetManager from './managers/AssetManager';
import VariableManager from './managers/VariableManager';
import MapManager from './managers/MapManager';
import FilterManager from './managers/FilterManager';
import FormattersManager from './managers/FormatterManager';

@autoInjectable()
class SegmentBuilder {
  protected command: string = '-version';

  protected filters: string = ''; // FFmpeg filters
  protected sources: string[] = []; // FFmpeg inputs

  protected source: string = '';
  protected destination: string = '';
  protected hwaccelArg: string = '';

  protected section: Section;

  constructor(
    protected project: Project,
    protected template: Template,
    protected segment: Segment,

    protected assetManager: AssetManager,
    protected variableManager: VariableManager,
    protected mapManager: MapManager,
    protected filterManager: FilterManager,
    protected formattersManager: FormattersManager,

    @inject('logger') private readonly logger: AbstractLogger,
    @inject('filesystemAdapter')
    protected readonly filesystemAdapter: AbstractFilesystem
  ) {
    if (this.template.descriptor.global.orientation === 'portrait') {
      const [width, height] = this.project.config.videoConfig.scale.split(':');
      this.project.config.videoConfig.scale = `${height}:${width}`;
    }
  }

  hydrate = (section: Section): SegmentBuilder => {
    this.section = section;
    this.section.inputs ??= [];

    this.segment.currentSection = this.section;

    this.assetManager.segment = this.segment;
    this.mapManager.segment = this.segment;
    this.filterManager.segment = this.segment;
    this.formattersManager.segment = this.segment;

    this.filesystemAdapter.setSegment(this.section.name);

    return this;
  };

  init = async (): Promise<boolean> => {
    this.source = this.filesystemAdapter.getSource();
    this.destination = this.filesystemAdapter.getDestination();

    this.logger.info(`[${this.section.name}][Source] ${this.source}`);
    this.logger.info(`[${this.section.name}][Dest] ${this.destination}`);

    await this.assetManager.setUpPaths();

    // Format background color if option is set
    if (this.section.options.backgroundColor) {
      this.section.options.backgroundColor = this.formattersManager.formatColor(this.section.options.backgroundColor);
    }

    try {
      // Fetch remote or cached assets
      await this.assetManager.fetchAssets();
      this.logger.info(`[${this.section.name}][Assets] fetched`);

      // Build FFmpeg maps
      await this.buildMaps();
      this.logger.info(`[${this.section.name}][Maps] built`);

      // Build FFmpeg filters
      await this.buildFilters();
      this.logger.info(`[${this.section.name}][Filters] built`);

      // Build FFmpeg inputs
      this.buildInputs();
      this.logger.info(`[${this.section.name}][Inputs] built`);

      // Fetch remote or cached fonts
      await this.assetManager.fetchFonts();
      this.logger.info(`[${this.section.name}][Fonts] fetched`);
    } catch (err) {
      return false;
    }

    // Configure Hardware Acceleration
    if (null !== this.project.config.hardwareConfig.hwaccel) {
      this.hwaccelArg = `-hwaccel ${this.project.config.hardwareConfig.hwaccel}`;
    }

    // Configure FFmpeg command
    this.configure();

    this.logger.info(`[${this.section.name}][Config] finalized`);

    return true;
  };

  protected configure = (): void => {};

  getCommand = () => this.command;

  buildInputs = (): void => {
    let { backgroundColor } = this.section.options;

    if (this.section.options.backgroundColor) {
      if (!this.segment.inputsAsset) {
        backgroundColor = 'white@0.0';
      }

      // Manage background color input
      this.sources.push(
        `-f lavfi -i color=c=${backgroundColor}` +
          `:s=${this.project.config.videoConfig.scale.replace(':', 'x')}` +
          `:d=${this.section.options.duration}`
      );
    }

    if (this.segment.inputsAsset) {
      for (const property in this.segment.inputsAsset) {
        if (Object.prototype.hasOwnProperty.call(this.segment.inputsAsset, property)) {
          this.sources.push(`-i ${this.segment.inputsAsset[property]}`);
        }
      }
    }
  };

  buildMaps = async (): Promise<void> => {
    this.segment.inputsAsset = [];

    await Promise.all(
      this.section.inputs.map((item: MapAnimationInput) => {
        if (
          item.type === 'frame' &&
          new RegExp('(.*?).(zip)$').test(item.url) &&
          this.template.assets.inputs[item.name]
        ) {
          // Retrieve unzipped frames
          for (let i = 1; i <= this.template.assets.inputs[item.name].length; i++) {
            this.segment.inputsAsset[`asset_${item.name}_${i}`] = this.template.assets.inputs[item.name][i - 1];
            this.mapManager.addMapAnimation(item, i);
          }

          if (!item.options.frames) {
            item.options.frames = this.template.assets.inputs[item.name].length;
          }
        } else if (item.type === 'frame' && item.options && item.options.frames) {
          // Retrieve cached frames
          for (let i = 1; i <= item.options.frames; i++) {
            this.segment.inputsAsset[`asset_${item}`] = this.assetManager.fetchCachedMedia(item, i);
            this.mapManager.addMapAnimation(item, i);
          }
        } else {
          // Process single media
          this.segment.inputsAsset[`asset_${item}`] = this.assetManager.fetchCachedMedia(item);
        }
      })
    );
  };

  buildFilters = async (): Promise<void> => {
    // Initalized filters if section doesn't have config
    if (!this.section.maps) {
      this.section.maps = [];
    }

    if (!this.section.filters) {
      this.section.filters = [];
    }

    // Force ratio
    if (this.section.options.forceAspectRatio !== false || this.section.options.forceOriginalAspectRatio) {
      let scaleFilter = this.project.config.videoConfig.scale;

      if (this.section.options.forceOriginalAspectRatio) {
        scaleFilter = `${this.project.config.videoConfig.scale}:force_original_aspect_ratio=decrease,pad=${this.project.config.videoConfig.scale}:(ow-iw)/2:(oh-ih)/2`;
      }

      this.section.filters = [
        { type: 'setsar', value: this.project.config.videoConfig.setsar },
        { type: 'scale', value: scaleFilter },
        ...this.section.filters,
      ];
    }

    // Build simple filters
    for (let i = 0; i < Object.keys(this.section.filters).length; i++) {
      this.segment.filtersList.push(this.filterManager.addFilter(this.section.filters[i]));
    }

    // Build map configuration with their filters
    for (let i = 0; i < Object.keys(this.section.maps).length; i++) {
      this.mapManager.addMap(this.section.maps[i]);
      this.segment.inputsMapCount++;
    }

    // Formatted filters
    if (this.segment.filtersList.length > 0) {
      let filtersFormatted = '';

      if (Object.keys(this.segment.filtersMapList).length > 0) {
        // Manage complex filter with maps
        filtersFormatted = this.segment.filtersMapList.join(';');
      } else {
        // Manage complex filter without maps
        filtersFormatted = this.segment.filtersList.join(',');
      }

      this.filters = ` -filter_complex "${filtersFormatted}" `;
      this.logger.debug(`[${this.section.name}][Filters] ${filtersFormatted}`);
    }

    // And finally add the final map if any
    if (this.segment.mapsList.length > 0) {
      this.filters = `${this.filters} -map [${this.segment.mapsList[this.segment.mapsList.length - 1]}] `;
      this.logger.debug(`[${this.section.name}][Maps] ${this.segment.mapsList.join(' ')}`);
    }
  };

  /**
   * Add blank audio to avoid silent map on cancatenation
   */
  addBlankAudio = (): string => {
    return (
      ' -f lavfi ' +
      ` -i anullsrc=channel_layout=${this.project.config.audioConfig.channelLayout}` +
      `:sample_rate=${this.project.config.audioConfig.sampleRate} `
    );
  };
}

export default SegmentBuilder;
