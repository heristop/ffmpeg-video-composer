import { singleton } from 'tsyringe';
import Template from '../../core/models/Template';
import Segment from '../../core/models/Segment';
import { Filter } from '@/core/types';
import FormatterManager from './FormatterManager';

@singleton()
class FilterManager {
  constructor(
    private readonly template: Template,
    protected readonly formattersManager: FormatterManager,
    public segment: Segment
  ) {}

  addFilter = (filter: Filter): string => {
    let output = '';

    // Manage suffixes on filter
    if (filter.range) {
      filter = this.remapEnableBetweenSuffix(filter);
    }

    // Remap custom types
    if (['fadein', 'fadeout'].includes(filter.type)) {
      filter = this.remapFadeTypeShortcuts(filter);
    }

    if (filter.value) {
      // Process single value filter
      output = this.formattersManager.formatMultipleTypesValue(filter);
    } else if (filter.values) {
      // Process multiples values filter
      output = this.formattersManager.formatMultipleTypesValues(filter);
    } else {
      output = `${filter.type}`;
    }

    return output;
  };

  remapEnableBetweenSuffix = (filter: Filter): Filter => {
    if (!filter.range) {
      return filter;
    }

    const durations = filter.range.split(':');

    if (durations.length < 2) {
      return filter;
    }

    let end = this.template.descriptor.global.transitionDuration;
    let start = 0;

    const extractTimeValue = (pattern: RegExp, duration: string): number | undefined => {
      const matches = pattern.exec(duration);
      return matches ? parseFloat(matches[1]) : undefined;
    };

    const startTime = extractTimeValue(/start=(.*)/, durations[0]);

    if (undefined !== startTime) {
      start = startTime;

      const endTime = extractTimeValue(/end=(.*)/, durations[1]);
      if (undefined !== endTime) {
        const time = this.segment.currentSection.options.duration;
        end = parseFloat(endTime.toString().replace('{{ section_duration }}', time.toString()));
      }
    }

    filter.value = `${filter.value}:enable='between(t,${start},${end})'`;

    return filter;
  };

  remapFadeTypeShortcuts = (filter: Filter): Filter => {
    switch (filter.type) {
      case 'fadein':
        filter.type = 'fade';

        if (!filter.values) {
          filter.values = {};
        }

        filter.values = {
          t: 'in',
          d: '{{ transitionDuration }}',
          ...filter.values,
        };
        break;
      case 'fadeout':
        filter.type = 'fade';

        if (!filter.values) {
          filter.values = {};
        }

        filter.values = {
          t: 'out',
          d: '{{ transitionDuration }}',
          st: '{{ transitionStartTime }}',
          ...filter.values,
        };
        break;
    }

    return filter;
  };
}

export default FilterManager;
