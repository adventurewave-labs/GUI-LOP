/**
 * @typedef {import('../../domain/api-key/api-key.js').ApiKey} ApiKey
 */

/**
 * ApiKeyRepository — port for ApiKey aggregate persistence.
 *
 * Implementations MUST never store the plaintext secret; only the SHA-256
 * hex digest produced by `ApiKeySecret.hash()` is acceptable.
 *
 * @typedef {Object} ApiKeyRepository
 * @property {(id: string) => Promise<ApiKey|null>} findById
 * @property {(hash: string) => Promise<ApiKey|null>} findByHash
 * @property {(userId: string) => Promise<ApiKey[]>} findActiveByUser
 * @property {(apiKey: ApiKey, uow?: object) => Promise<void>} save
 */
export const ApiKeyRepositorySymbol = Symbol.for('iam.ApiKeyRepository');
