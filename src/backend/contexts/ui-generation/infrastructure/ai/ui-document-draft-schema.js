/**
 * ui-document-draft-schema.js — shared validator for the `UIDocumentDraft`
 * shape returned by vendor adapters. Used by every adapter so the same
 * non-conformance rules apply everywhere.
 *
 * Validation rules (lightweight, hand-rolled to avoid a JSON-Schema dep):
 *   - `layout.kind` must be one of stack | grid | tabs | form.
 *   - `layout.regions` must be an array. Each region has a `name` (string)
 *     and `fields` (array of strings referencing field ids).
 *   - `fields` must be a non-empty array. Each field has `id`, `label`,
 *     and `type` from the platform's supported set. Optional pieces
 *     (`validations`, `component`, `options`) are shape-checked when
 *     present.
 *
 * On failure, throws `AIBadResponse` with a structured `details` payload.
 */
import { AIBadResponse } from './domain-errors.js';

const LAYOUT_KINDS = new Set(['stack', 'grid', 'tabs', 'form']);
const FIELD_TYPES = new Set(['text', 'email', 'number', 'textarea', 'boolean', 'date', 'select']);

function fail(reason, details = {}) {
  throw new AIBadResponse(`AI response failed schema: ${reason}`, { reason, ...details });
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function validateLayout(layout) {
  if (!isObject(layout)) fail('layout missing');
  if (!LAYOUT_KINDS.has(layout.kind)) fail('layout.kind invalid', { kind: layout.kind });
  if (!Array.isArray(layout.regions)) fail('layout.regions not array');
  layout.regions.forEach((r, idx) => {
    if (!isObject(r)) fail('layout.regions[i] not object', { idx });
    if (typeof r.name !== 'string' || r.name.length === 0) {
      fail('layout.regions[i].name invalid', { idx });
    }
    if (!Array.isArray(r.fields)) fail('layout.regions[i].fields not array', { idx });
    r.fields.forEach((fid, fIdx) => {
      if (typeof fid !== 'string') fail('layout.regions[i].fields[j] not string', { idx, fIdx });
    });
  });
}

function validateField(f, idx) {
  if (!isObject(f)) fail('fields[i] not object', { idx });
  if (typeof f.id !== 'string' || f.id.length === 0) fail('fields[i].id invalid', { idx });
  if (typeof f.label !== 'string' || f.label.length === 0) fail('fields[i].label invalid', { idx });
  if (!FIELD_TYPES.has(f.type)) fail('fields[i].type invalid', { idx, type: f.type });
  if (f.validations !== undefined) {
    if (!Array.isArray(f.validations)) fail('fields[i].validations not array', { idx });
    f.validations.forEach((v, vIdx) => {
      if (!isObject(v)) fail('fields[i].validations[j] not object', { idx, vIdx });
      if (typeof v.id !== 'string' || typeof v.kind !== 'string') {
        fail('fields[i].validations[j] missing id/kind', { idx, vIdx });
      }
    });
  }
  if (f.component !== undefined && f.component !== null) {
    if (!isObject(f.component) || typeof f.component.name !== 'string') {
      fail('fields[i].component invalid', { idx });
    }
  }
  if (f.options !== undefined) {
    if (!Array.isArray(f.options)) fail('fields[i].options not array', { idx });
  }
}

/**
 * Throws `AIBadResponse` if `draft` is not a conformant `UIDocumentDraft`.
 * Returns the draft on success.
 *
 * @param {unknown} draft
 * @returns {object}
 */
export function validateUIDocumentDraft(draft) {
  if (!isObject(draft)) fail('draft not object');
  validateLayout(draft.layout);
  if (!Array.isArray(draft.fields) || draft.fields.length === 0) {
    fail('fields missing or empty');
  }
  draft.fields.forEach((f, idx) => validateField(f, idx));
  return draft;
}

/** True if `s` parses to JSON matching the draft schema. Never throws. */
export function tryParseDraft(text) {
  if (typeof text !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  try {
    validateUIDocumentDraft(parsed);
    return parsed;
  } catch {
    return null;
  }
}
