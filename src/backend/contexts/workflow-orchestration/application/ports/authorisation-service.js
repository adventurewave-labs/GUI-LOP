/**
 * Port to the Identity & Access AuthorisationService.
 *
 * @typedef {object} AuthorisationService
 * @property {(input: {
 *   actor: { id: string, role?: string },
 *   action: string,
 *   resource?: { type: string, id?: string, ownerId?: string },
 * }) => Promise<{ allowed: boolean, reason?: string }>} authorise
 */

/** Default test/dev impl: allow if a non-empty actor is present. */
export class AlwaysAllowAuthorisationService {
  async authorise({ actor }) {
    if (!actor || !actor.id) return { allowed: false, reason: 'no_actor' };
    return { allowed: true };
  }
}

/** Reject everything. Useful for `forbidden` test paths. */
export class AlwaysDenyAuthorisationService {
  async authorise() {
    return { allowed: false, reason: 'denied' };
  }
}
