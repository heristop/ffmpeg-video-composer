// The editor managers a browser compile resolves by name from the DI container.
import { container } from 'tsyringe';
import AssetManager from './AssetManager';
import VariableManager from './VariableManager';
import MapManager from './MapManager';
import FilterManager from './FilterManager';
import FormattersManager from './FormatterManager';

export function registerEditorManagers(): void {
  container.register('AssetManager', { useClass: AssetManager });
  container.register('VariableManager', { useClass: VariableManager });
  container.register('MapManager', { useClass: MapManager });
  container.register('FilterManager', { useClass: FilterManager });
  container.register('FormattersManager', { useClass: FormattersManager });
}
