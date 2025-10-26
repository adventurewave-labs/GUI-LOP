/**
 * API Versioning Middleware
 * Comprehensive versioning support with backward compatibility and deprecation handling
 */

import semver from 'semver';
import { parse } from 'accept-language-parser';

/**
 * API Version Configuration
 */
export const API_VERSIONS = {
  'v1': {
    version: '1.0.0',
    status: 'current',
    deprecated: false,
    deprecationDate: null,
    sunsetDate: null,
    supportedUntil: null,
    migrationGuide: null,
    features: [
      'authentication',
      'workflows',
      'users',
      'basic-rate-limiting',
      'websockets'
    ],
    breakingChanges: []
  },
  'v2': {
    version: '2.0.0',
    status: 'beta',
    deprecated: false,
    deprecationDate: null,
    sunsetDate: null,
    supportedUntil: null,
    migrationGuide: '/api/v2/docs/migration',
    features: [
      'authentication',
      'workflows',
      'users',
      'advanced-rate-limiting',
      'websockets',
      'batch-operations',
      'advanced-filtering'
    ],
    breakingChanges: [
      'workflow.status field renamed to workflowState',
      'authentication headers changed from X-API-Key to Authorization Bearer',
      'date formats now strictly ISO8601'
    ]
  }
};

/**
 * Default API version
 */
export const DEFAULT_API_VERSION = 'v1';
export const LATEST_API_VERSION = 'v1'; // Update when v2 is released

/**
 * Version extraction strategies
 */
const VERSION_EXTRACTION_STRATEGIES = {
  // URL path versioning: /api/v1/users
  PATH: 'path',
  // Header versioning: Accept-Version: v1
  HEADER: 'header',
  // Query parameter versioning: ?version=v1
  QUERY: 'query',
  // Content negotiation: Accept: application/vnd.api+json;version=1
  CONTENT_NEGOTIATION: 'content-negotiation',
  // Subdomain versioning: v1.api.example.com
  SUBDOMAIN: 'subdomain'
};

/**
 * Extract version from request using multiple strategies
 */
export const extractApiVersion = (req) => {
  const strategies = [
    extractFromPath,
    extractFromHeader,
    extractFromQuery,
    extractFromContentNegotiation,
    extractFromSubdomain
  ];

  for (const strategy of strategies) {
    const version = strategy(req);
    if (version) {
      return version;
    }
  }

  return DEFAULT_API_VERSION;
};

/**
 * Extract version from URL path
 * Example: /api/v1/users -> v1
 */
const extractFromPath = (req) => {
  const pathRegex = /^\/api\/(v\d+)(?:\/.*)?$/;
  const match = req.path.match(pathRegex);
  return match ? match[1] : null;
};

/**
 * Extract version from Accept-Version header
 * Example: Accept-Version: v1
 */
const extractFromHeader = (req) => {
  const acceptVersion = req.headers['accept-version'];
  if (acceptVersion && /^v\d+$/.test(acceptVersion)) {
    return acceptVersion;
  }
  return null;
};

/**
 * Extract version from query parameter
 * Example: /api/users?version=v1
 */
const extractFromQuery = (req) => {
  const version = req.query.version;
  if (version && /^v\d+$/.test(version)) {
    return version;
  }
  return null;
};

/**
 * Extract version from Accept header (content negotiation)
 * Example: Accept: application/vnd.api+json;version=1
 */
const extractFromContentNegotiation = (req) => {
  const acceptHeader = req.headers.accept;
  if (!acceptHeader) return null;

  // Parse accept header for version parameter
  const versionMatch = acceptHeader.match(/version=(\d+)/);
  if (versionMatch) {
    return `v${versionMatch[1]}`;
  }

  // Parse custom media type
  const customTypeMatch = acceptHeader.match(/application\/vnd\.api\.v(\d+)\+json/);
  if (customTypeMatch) {
    return `v${customTypeMatch[1]}`;
  }

  return null;
};

/**
 * Extract version from subdomain
 * Example: v1.api.example.com -> v1
 */
const extractFromSubdomain = (req) => {
  const host = req.headers.host;
  if (!host) return null;

  const subdomainMatch = host.match(/^v(\d+)\./);
  if (subdomainMatch) {
    return `v${subdomainMatch[1]}`;
  }

  return null;
};

/**
 * Validate if version is supported
 */
export const isVersionSupported = (version) => {
  return Object.keys(API_VERSIONS).includes(version);
};

/**
 * Check if version is deprecated
 */
export const isVersionDeprecated = (version) => {
  const versionConfig = API_VERSIONS[version];
  return versionConfig && versionConfig.deprecated;
};

/**
 * Get version configuration
 */
export const getVersionConfig = (version) => {
  return API_VERSIONS[version] || null;
};

/**
 * API Versioning Middleware
 */
export const apiVersioning = (options = {}) => {
  const {
    defaultVersion = DEFAULT_API_VERSION,
    validVersions = Object.keys(API_VERSIONS),
    paramName = 'version',
    headerName = 'Accept-Version',
    strictMode = false,
    versionResponseHeader = 'API-Version',
    deprecationWarningHeader = 'Deprecation',
    sunsetHeader = 'Sunset'
  } = options;

  return (req, res, next) => {
    try {
      // Extract version from request
      let requestedVersion = extractApiVersion(req);

      // Validate version
      if (!requestedVersion) {
        requestedVersion = defaultVersion;
      }

      if (!validVersions.includes(requestedVersion)) {
        if (strictMode) {
          return res.status(400).json({
            success: false,
            message: `Unsupported API version: ${requestedVersion}`,
            code: 'UNSUPPORTED_API_VERSION',
            details: {
              requestedVersion,
              supportedVersions: validVersions,
              defaultVersion
            },
            timestamp: new Date().toISOString(),
            requestId: req.id || 'unknown'
          });
        } else {
          // Fallback to default version in non-strict mode
          requestedVersion = defaultVersion;
        }
      }

      // Get version configuration
      const versionConfig = getVersionConfig(requestedVersion);

      // Add version information to request
      req.apiVersion = requestedVersion;
      req.apiVersionConfig = versionConfig;

      // Add version response headers
      res.setHeader(versionResponseHeader, requestedVersion);

      // Add deprecation warnings if applicable
      if (versionConfig && versionConfig.deprecated) {
        res.setHeader(deprecationWarningHeader, 'true');

        if (versionConfig.sunsetDate) {
          res.setHeader(sunsetHeader, versionConfig.sunsetDate);
        }

        if (versionConfig.migrationGuide) {
          res.setHeader('Link', `<${versionConfig.migrationGuide}>; rel="migration-guide"`);
        }
      }

      // Add supported versions header
      res.setHeader('API-Supported-Versions', validVersions.join(', '));
      res.setHeader('API-Latest-Version', LATEST_API_VERSION);

      // Log version usage for analytics
      logVersionUsage(req, requestedVersion);

      next();
    } catch (error) {
      console.error('API versioning error:', error);
      next(error);
    }
  };
};

/**
 * Version-specific route handler
 */
export const versionRouter = (routes = {}) => {
  return (req, res, next) => {
    const version = req.apiVersion;
    const handler = routes[version] || routes[DEFAULT_API_VERSION];

    if (!handler) {
      return res.status(404).json({
        success: false,
        message: `Route not found for API version: ${version}`,
        code: 'ROUTE_NOT_FOUND_FOR_VERSION',
        timestamp: new Date().toISOString(),
        requestId: req.id || 'unknown'
      });
    }

    handler(req, res, next);
  };
};

/**
 * Backward compatibility middleware
 */
export const backwardCompatibility = (compatibilityMap = {}) => {
  return (req, res, next) => {
    const version = req.apiVersion;
    const compatRules = compatibilityMap[version];

    if (!compatRules) {
      return next();
    }

    // Apply transformation rules
    for (const [field, rule] of Object.entries(compatRules)) {
      if (rule.type === 'rename') {
        if (req.body && req.body[field] !== undefined) {
          req.body[rule.to] = req.body[field];
          delete req.body[field];
        }
      } else if (rule.type === 'transform') {
        if (req.body && req.body[field] !== undefined) {
          req.body[field] = rule.transform(req.body[field]);
        }
      } else if (rule.type === 'default') {
        if (req.body && req.body[field] === undefined) {
          req.body[field] = rule.value;
        }
      }
    }

    next();
  };
};

/**
 * Response transformation for backward compatibility
 */
export const responseTransform = (transforms = {}) => {
  return (req, res, next) => {
    const version = req.apiVersion;
    const transform = transforms[version];

    if (!transform) {
      return next();
    }

    // Store original res.json
    const originalJson = res.json;

    // Override res.json to transform response
    res.json = function(data) {
      if (transform && typeof transform === 'function') {
        data = transform(data, req);
      }

      return originalJson.call(this, data);
    };

    next();
  };
};

/**
 * Version deprecation warning middleware
 */
export const deprecationWarning = (options = {}) => {
  const {
    warningHeader = 'Deprecation',
    sunsetHeader = 'Sunset',
    linkHeader = 'Link',
    logWarnings = true
  } = options;

  return (req, res, next) => {
    const version = req.apiVersion;
    const versionConfig = getVersionConfig(version);

    if (versionConfig && versionConfig.deprecated) {
      // Add warning headers
      res.setHeader(warningHeader, 'true');

      if (versionConfig.sunsetDate) {
        res.setHeader(sunsetHeader, versionConfig.sunsetDate);
      }

      if (versionConfig.migrationGuide) {
        res.setHeader(linkHeader, `<${versionConfig.migrationGuide}>; rel="migration-guide"`);
      }

      // Log deprecation usage
      if (logWarnings) {
        console.warn(`Deprecated API version ${version} used by ${req.ip} - ${req.path}`);
      }

      // Add deprecation notice to response if supported
      if (req.headers.accept === 'application/vnd.api+json') {
        res.locals.deprecationWarning = {
          version,
          deprecated: true,
          sunsetDate: versionConfig.sunsetDate,
          migrationGuide: versionConfig.migrationGuide,
          recommendedVersion: LATEST_API_VERSION
        };
      }
    }

    next();
  };
};

/**
 * Feature flag middleware based on version
 */
export const versionFeatureFlags = (featureMap = {}) => {
  return (req, res, next) => {
    const version = req.apiVersion;
    const versionConfig = getVersionConfig(version);

    if (!versionConfig) {
      return next();
    }

    // Set feature flags
    req.features = {
      ...versionConfig.features.reduce((flags, feature) => {
        flags[feature] = true;
        return flags;
      }, {}),
      ...featureMap[version]
    };

    next();
  };
};

/**
 * Version migration helper
 */
export const migrateRequest = (fromVersion, toVersion, migrationRules) => {
  return (req, res, next) => {
    if (req.apiVersion !== fromVersion) {
      return next();
    }

    try {
      // Apply migration rules
      for (const rule of migrationRules) {
        if (rule.type === 'field') {
          migrateField(req, rule);
        } else if (rule.type === 'header') {
          migrateHeader(req, rule);
        } else if (rule.type === 'query') {
          migrateQuery(req, rule);
        }
      }

      // Update version
      req.apiVersion = toVersion;
      req.apiVersionConfig = getVersionConfig(toVersion);

      next();
    } catch (error) {
      console.error('Migration error:', error);
      res.status(400).json({
        success: false,
        message: 'Migration failed',
        code: 'MIGRATION_ERROR',
        details: {
          fromVersion,
          toVersion,
          error: error.message
        },
        timestamp: new Date().toISOString(),
        requestId: req.id || 'unknown'
      });
    }
  };
};

/**
 * Migrate field in request body
 */
const migrateField = (req, rule) => {
  const { from, to, transform, required } = rule;

  if (req.body && req.body[from] !== undefined) {
    let value = req.body[from];

    if (transform) {
      value = transform(value);
    }

    req.body[to] = value;

    if (from !== to) {
      delete req.body[from];
    }
  } else if (required) {
    throw new Error(`Required field '${from}' missing for migration`);
  }
};

/**
 * Migrate header
 */
const migrateHeader = (req, rule) => {
  const { from, to, transform } = rule;

  if (req.headers[from]) {
    let value = req.headers[from];

    if (transform) {
      value = transform(value);
    }

    req.headers[to.toLowerCase()] = value;

    if (from !== to) {
      delete req.headers[from];
    }
  }
};

/**
 * Migrate query parameter
 */
const migrateQuery = (req, rule) => {
  const { from, to, transform } = rule;

  if (req.query[from] !== undefined) {
    let value = req.query[from];

    if (transform) {
      value = transform(value);
    }

    req.query[to] = value;

    if (from !== to) {
      delete req.query[from];
    }
  }
};

/**
 * Version analytics
 */
const versionUsageStats = new Map();

/**
 * Log version usage
 */
const logVersionUsage = (req, version) => {
  const key = `${version}:${new Date().toISOString().substring(0, 10)}`;
  const current = versionUsageStats.get(key) || { count: 0, ips: new Set() };

  current.count++;
  current.ips.add(req.ip);

  versionUsageStats.set(key, current);
};

/**
 * Get version usage statistics
 */
export const getVersionUsageStats = (days = 30) => {
  const stats = {};
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  for (const [key, data] of versionUsageStats.entries()) {
    const [version, date] = key.split(':');
    const keyDate = new Date(date);

    if (keyDate >= cutoffDate) {
      if (!stats[version]) {
        stats[version] = {
          totalRequests: 0,
          uniqueIps: new Set(),
          dailyUsage: {}
        };
      }

      stats[version].totalRequests += data.count;
      data.ips.forEach(ip => stats[version].uniqueIps.add(ip));
      stats[version].dailyUsage[date] = data.count;
    }
  }

  // Convert Sets to Arrays for JSON serialization
  for (const version in stats) {
    stats[version].uniqueIps = Array.from(stats[version].uniqueIps);
  }

  return stats;
};

/**
 * Version health check
 */
export const checkVersionHealth = () => {
  const health = {
    status: 'healthy',
    versions: {},
    overall: {
      total: Object.keys(API_VERSIONS).length,
      current: 0,
      deprecated: 0,
      beta: 0
    }
  };

  for (const [version, config] of Object.entries(API_VERSIONS)) {
    const versionHealth = {
      version: config.version,
      status: config.status,
      deprecated: config.deprecated,
      deprecationDate: config.deprecationDate,
      sunsetDate: config.sunsetDate
    };

    health.versions[version] = versionHealth;

    if (config.status === 'current') {
      health.overall.current++;
    } else if (config.deprecated) {
      health.overall.deprecated++;
      if (health.status === 'healthy') {
        health.status = 'warning';
      }
    } else if (config.status === 'beta') {
      health.overall.beta++;
    }
  }

  return health;
};

/**
 * Version negotiation middleware
 */
export const versionNegotiation = (supportedVersions) => {
  return (req, res, next) => {
    const preferredVersions = parseVersionPreferences(req);
    const selectedVersion = negotiateVersion(preferredVersions, supportedVersions);

    if (!selectedVersion) {
      return res.status(406).json({
        success: false,
        message: 'No acceptable API version found',
        code: 'VERSION_NEGOTIATION_FAILED',
        details: {
          preferred: preferredVersions,
          supported: supportedVersions
        },
        timestamp: new Date().toISOString(),
        requestId: req.id || 'unknown'
      });
    }

    req.apiVersion = selectedVersion;
    req.apiVersionConfig = getVersionConfig(selectedVersion);

    next();
  };
};

/**
 * Parse version preferences from request headers
 */
const parseVersionPreferences = (req) => {
  const preferences = [];

  // Accept-Version header
  if (req.headers['accept-version']) {
    preferences.push(req.headers['accept-version']);
  }

  // Accept header with version parameter
  if (req.headers.accept) {
    const match = req.headers.accept.match(/version=(v\d+)/);
    if (match) {
      preferences.push(match[1]);
    }
  }

  return preferences;
};

/**
 * Negotiate best version based on preferences
 */
const negotiateVersion = (preferred, supported) => {
  for (const prefVersion of preferred) {
    if (supported.includes(prefVersion)) {
      return prefVersion;
    }
  }

  return supported[0]; // Fallback to first supported version
};

export default {
  // Configuration
  API_VERSIONS,
  DEFAULT_API_VERSION,
  LATEST_API_VERSION,
  VERSION_EXTRACTION_STRATEGIES,

  // Core middleware
  apiVersioning,
  versionRouter,
  backwardCompatibility,
  responseTransform,
  deprecationWarning,
  versionFeatureFlags,

  // Migration
  migrateRequest,

  // Utilities
  extractApiVersion,
  isVersionSupported,
  isVersionDeprecated,
  getVersionConfig,
  versionNegotiation,

  // Analytics
  getVersionUsageStats,
  checkVersionHealth
};