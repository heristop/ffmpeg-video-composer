import { z } from 'zod';

// One colour token, as every colour field that reaches a filtergraph accepts it: #RRGGBB / #RGB / 0x…, a
// colour name, an @alpha suffix, a $color.<name> theme token, or one {{ VARIABLE }} (with an optional
// @alpha). Colours are interpolated into filter options (`colorkey=<c>`, `color=c=<c>`, `fontcolor='<c>'`),
// so the grammar leaves out every filtergraph separator, quote and whitespace.
export const COLOR_TOKEN = /^(?:[#$A-Za-z0-9@._]+|\{\{ ?[A-Za-z_][A-Za-z0-9_]* ?\}\}(?:@[0-9.]+)?)$/;

export const ColorToken = z
  .string()
  .regex(COLOR_TOKEN, 'a colour: #RRGGBB, a name, an @alpha suffix, $color.<token> or {{ VARIABLE }}');
