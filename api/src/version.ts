/**
 * The API version reported by Swagger and by GET /v1/health.
 *
 * A constant rather than a package.json import: tsconfig has no
 * resolveJsonModule, and `nest build` copies neither the manifest nor its
 * version into dist, so reading it at runtime yields undefined in production —
 * exactly where the health payload matters most.
 */
export const API_VERSION = '1.0.0';

/** Display name, shared by the Swagger title and the health payload. */
export const API_NAME = 'TH-LABS API';
