// The template model with its validator loaded, for the entries that validate from the start (Node, React
// Native) and the compile pipeline. The browser entry exports the model alone (template-model) and loads the
// validator on demand.
import '../../services/register-template-validator';

export { default } from './template-model';
export { assertEffectsResolved } from '../partials';
