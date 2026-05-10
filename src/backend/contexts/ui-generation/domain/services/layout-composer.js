/**
 * LayoutComposer — pure. Produces a Layout from a UISpecification, using either
 * the spec's explicit layout or a default per-strategy heuristic.
 */

import { Layout, LAYOUT_KINDS } from '../layout.js';

export function compose(spec, ctx = {}) {
  if (spec.layout) return spec.layout;

  const fieldIds = spec.fields.map((f) => f.id);
  const kind = ctx.kind ?? LAYOUT_KINDS.FORM;

  return new Layout({
    kind,
    regions: [
      {
        name: 'main',
        fields: fieldIds
      }
    ]
  });
}
