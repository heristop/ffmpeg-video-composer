import { singleton } from 'tsyringe';
import Template from '../../core/models/Template';
import Segment from '../../core/models/Segment';
import { Map, MapAnimationInput } from '@/core/types';
import FormattersManager from './FormatterManager';
import FilterManager from './FilterManager';

@singleton()
class MapManager {
  constructor(
    private readonly template: Template,
    protected formattersManager: FormattersManager,
    protected filterManager: FilterManager,
    public segment: Segment
  ) {}

  addMap = (map: Map): void => {
    let mappedInputs = '';
    let mappedOutputs = '';

    // Manage mandatory attributs
    if (map.inputs) {
      map.inputs.forEach((input: string) => {
        mappedInputs += `[${this.mapInputsVariables(input)}]`;
      });
    } else {
      throw new Error(`[Map][${this.segment.currentSection.name}] Missing inputs`);
    }

    if (map.outputs) {
      map.outputs.forEach((output: string) => {
        mappedOutputs += `[${output}]`;
        this.segment.mapsList.push(output);
      });
    } else {
      throw new Error(`[Map][${this.segment.currentSection.name}] Missing outputs for [${map.inputs.join(',')}]`);
    }

    // Manage optional attributs
    if (!map.options) {
      map.options = {};
    }

    if (!map.filters) {
      map.filters = [];
    }

    if (
      (map.options.useSectionFilters || Object.keys(map.filters).length === 0) &&
      this.segment.currentSection.filters
    ) {
      map.filters = [
        // Add background filters
        ...map.filters,
        ...this.segment.currentSection.filters,
      ];
    }

    const filtersMapList: string[] = [];

    for (let i = 0; i < Object.keys(map.filters).length; i++) {
      // Process single filters
      filtersMapList.push(this.filterManager.addFilter(map.filters[i]));
    }

    this.segment.filtersMapList.push(mappedInputs + filtersMapList.join(',') + mappedOutputs);
  };

  addMapAnimation = (input: MapAnimationInput, frame: number): void => {
    let videoInputIncrement: number = this.getVideoInputIncrement();
    videoInputIncrement += this.segment.inputsMapCount;

    let useSectionFilters = false;
    let frequency = 0.5;

    if (input.options.frequency) {
      frequency = input.options.frequency;
    }

    let inputs = [`${input.name}_${frame - 1}`, `${videoInputIncrement}:v`];
    const outputs = [`${input.name}_${frame}`];
    const start = (frame - 1) * frequency;
    let end = frame * frequency;

    // Persist last frame on screen
    if (this.hasLastFrameAnimationPersisted(input, frame)) {
      end = this.segment.currentSection.options.duration;
    }

    if (!input.filters) {
      input.filters = [];
    }

    const filters = [
      {
        type: 'overlay',
        value: input.options.overlay,
        range: `start=${start}:end=${end}`,
      },
      {
        type: 'scale',
        value: input.options.scale,
      },
      // Add extra filters
      ...input.filters,
    ];

    // Concat main video for the first frame only
    if (frame === 1) {
      if (this.segment.mapsList[this.segment.mapsList.length - 1]) {
        // Concat with the last frame of previous animation
        inputs = [`${this.segment.mapsList[this.segment.mapsList.length - 1]}`, `${videoInputIncrement + 1}:v`];
      } else {
        // Concat with the last frame
        inputs = [`${videoInputIncrement}:v`, `${videoInputIncrement + 1}:v`];
      }

      // Apply filters for first frame of first animation
      if (this.segment.inputsMapCount === 0) {
        useSectionFilters = true;
      }
    }

    // Increment inputs count
    this.segment.inputsMapCount++;

    this.addMap({
      inputs,
      filters,
      outputs,
      options: {
        useSectionFilters,
      },
    });
  };

  getVideoInputIncrement = (): number => {
    let increment = 0;

    switch (this.segment.currentSection.type) {
      case 'project_video':
        increment = 0;
        break;
      case 'video':
        if (
          !this.segment.currentSection.options.useVideoSection ||
          this.segment.currentSection.options.muteSection === false
        ) {
          increment = 0;
        } else {
          // 0 is used by fake audio
          increment = 1;
        }
        break;
      default:
        increment = 1;
    }

    return increment;
  };

  hasLastFrameAnimationPersisted = (input: MapAnimationInput, frame: number): boolean => {
    if (input.options.persistent) {
      if (!input.options.frames) {
        // Option frames is optional with Zip animation
        input.options.frames = this.template.assets.inputs[input.name].length;
      }

      if (frame === input.options.frames) {
        return true;
      }
    }

    return false;
  };

  /**
   * Replace variables in inputs
   */
  mapInputsVariables = (value: string): string => {
    const { inputs } = this.segment.currentSection;

    if (inputs && Object.keys(inputs).length > 0) {
      let hasAnimation = false;

      Object.keys(inputs).forEach((key) => {
        value = value.replace(new RegExp(/^@video$/, 'g'), `${this.getVideoInputIncrement()}:v`);

        // Manage last input for animation
        if (inputs[key].type == 'frame') {
          value = value.replace(
            new RegExp(`@${inputs[key].name}`, 'g'),
            `${inputs[key].name}_${inputs[key].options.frames}`
          );
          hasAnimation = true;
        } else {
          let increment: number = this.getVideoInputIncrement();

          if (hasAnimation) {
            increment += this.segment.inputsMapCount + 1;
          } else {
            increment += parseInt(key) + 1;
          }

          value = value.replace(new RegExp(`@${inputs[key].name}`, 'g'), `${increment}:v`);
        }
      });
    }

    return value;
  };
}

export default MapManager;
