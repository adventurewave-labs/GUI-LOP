/**
 * GenerationStrategySelector — pure. Picks a generation strategy from a hint
 * and the spec characteristics.
 *
 * Strategies:
 *   - 'static-form'  : spec only contains form fields → render a single form.
 *   - 'dashboard'    : spec hints at dashboard layout.
 *   - 'composite'    : mixed regions / multiple component kinds.
 */

export const STRATEGIES = Object.freeze({
  STATIC_FORM: 'static-form',
  DASHBOARD: 'dashboard',
  COMPOSITE: 'composite'
});

export function select(spec) {
  if (spec.strategyHint && Object.values(STRATEGIES).includes(spec.strategyHint)) {
    return spec.strategyHint;
  }

  const layout = spec.layout;
  if (layout && layout.kind === 'tabs') return STRATEGIES.COMPOSITE;
  if (layout && layout.regions.length > 1) return STRATEGIES.COMPOSITE;

  if (spec.fields.length === 0) return STRATEGIES.DASHBOARD;
  return STRATEGIES.STATIC_FORM;
}
