/**
 * Client-side caching hook for API responses and user data
 * Implements TTL-based caching with automatic cleanup
 */

class CacheManager {
  constructor(defaultTTL = 5 * 60 * 1000) { // 5 minutes default
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
    this.cleanupInterval = null;
    this.startCleanup();
  }

  // Set cache entry with TTL
  set(key, value, ttl = this.defaultTTL) {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl,
      hits: 0
    });
  }

  // Get cache entry
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Update hit count
    entry.hits++;
    return entry.value;
  }

  // Check if key exists and is valid
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  // Delete specific key
  delete(key) {
    return this.cache.delete(key);
  }

  // Clear all cache
  clear() {
    this.cache.clear();
  }

  // Get cache statistics
  getStats() {
    const entries = Array.from(this.cache.values());
    const totalSize = this.cache.size;
    const totalHits = entries.reduce((sum, entry) => sum + entry.hits, 0);
    const averageHits = totalSize > 0 ? totalHits / totalSize : 0;

    return {
      totalSize,
      totalHits,
      averageHits,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  // Estimate memory usage (rough approximation)
  estimateMemoryUsage() {
    let totalSize = 0;
    for (const [key, entry] of this.cache) {
      totalSize += key.length * 2; // UTF-16 characters
      totalSize += JSON.stringify(entry.value).length * 2;
      totalSize += 64; // Object overhead
    }
    return totalSize;
  }

  // Cleanup expired entries
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }

  // Start automatic cleanup
  startCleanup() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Cleanup every minute
  }

  // Stop automatic cleanup
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Global cache instance
const globalCache = new CacheManager();

// React hook for caching
export const useCache = (customTTL) => {
  const [cache] = React.useState(() => new CacheManager(customTTL));

  React.useEffect(() => {
    return () => {
      cache.stopCleanup();
    };
  }, [cache]);

  return cache;
};

// Hook for cached API calls
export const useCachedFetch = () => {
  const cache = useCache();
  const [loading, setLoading] = React.useState(new Map());
  const [error, setError] = React.useState(new Map());

  const cachedFetch = React.useCallback(async (url, options = {}) => {
    const cacheKey = `${url}:${JSON.stringify(options)}`;

    // Check cache first
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    // Set loading state
    setLoading(prev => new Map(prev).set(cacheKey, true));
    setError(prev => {
      const newMap = new Map(prev);
      newMap.delete(cacheKey);
      return newMap;
    });

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Cache the response
      const ttl = options.cacheTTL || 5 * 60 * 1000; // 5 minutes default
      cache.set(cacheKey, data, ttl);

      setLoading(prev => {
        const newMap = new Map(prev);
        newMap.delete(cacheKey);
        return newMap;
      });

      return data;
    } catch (err) {
      setError(prev => new Map(prev).set(cacheKey, err));
      setLoading(prev => {
        const newMap = new Map(prev);
        newMap.delete(cacheKey);
        return newMap;
      });
      throw err;
    }
  }, [cache]);

  const invalidate = React.useCallback((url, options = {}) => {
    const cacheKey = `${url}:${JSON.stringify(options)}`;
    cache.delete(cacheKey);
  }, [cache]);

  const isLoading = React.useCallback((url, options = {}) => {
    const cacheKey = `${url}:${JSON.stringify(options)}`;
    return loading.has(cacheKey);
  }, [loading]);

  const hasError = React.useCallback((url, options = {}) => {
    const cacheKey = `${url}:${JSON.stringify(options)}`;
    return error.has(cacheKey);
  }, [error]);

  const getError = React.useCallback((url, options = {}) => {
    const cacheKey = `${url}:${JSON.stringify(options)}`;
    return error.get(cacheKey);
  }, [error]);

  return {
    cachedFetch,
    invalidate,
    isLoading,
    hasError,
    getError,
    getStats: cache.getStats.bind(cache),
    clear: cache.clear.bind(cache)
  };
};

// Hook for caching user data
export const useUserCache = () => {
  const cache = useCache(10 * 60 * 1000); // 10 minutes for user data

  const cacheUser = React.useCallback((user) => {
    if (user && user.id) {
      cache.set(`user:${user.id}`, user);
      cache.set('currentUser', user);
    }
  }, [cache]);

  const getUser = React.useCallback((userId) => {
    return cache.get(`user:${userId}`);
  }, [cache]);

  const getCurrentUser = React.useCallback(() => {
    return cache.get('currentUser');
  }, [cache]);

  const invalidateUser = React.useCallback((userId) => {
    cache.delete(`user:${userId}`);
    if (getCurrentUser()?.id === userId) {
      cache.delete('currentUser');
    }
  }, [cache, getCurrentUser]);

  return {
    cacheUser,
    getUser,
    getCurrentUser,
    invalidateUser,
    getStats: cache.getStats.bind(cache)
  };
};

// Hook for caching workflow data
export const useWorkflowCache = () => {
  const cache = useCache(2 * 60 * 1000); // 2 minutes for workflow data

  const cacheWorkflows = React.useCallback((workflows) => {
    cache.set('workflows', workflows);
    workflows.forEach(workflow => {
      cache.set(`workflow:${workflow.id}`, workflow);
    });
  }, [cache]);

  const getWorkflows = React.useCallback(() => {
    return cache.get('workflows') || [];
  }, [cache]);

  const getWorkflow = React.useCallback((workflowId) => {
    return cache.get(`workflow:${workflowId}`);
  }, [cache]);

  const cacheWorkflow = React.useCallback((workflow) => {
    if (workflow && workflow.id) {
      cache.set(`workflow:${workflow.id}`, workflow);
    }
  }, [cache]);

  const invalidateWorkflows = React.useCallback(() => {
    cache.delete('workflows');
  }, [cache]);

  const invalidateWorkflow = React.useCallback((workflowId) => {
    cache.delete(`workflow:${workflowId}`);
  }, [cache]);

  return {
    cacheWorkflows,
    getWorkflows,
    getWorkflow,
    cacheWorkflow,
    invalidateWorkflows,
    invalidateWorkflow,
    getStats: cache.getStats.bind(cache)
  };
};

export { globalCache };
export default useCache;