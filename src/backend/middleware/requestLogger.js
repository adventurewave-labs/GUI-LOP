/**
 * Request Logging Middleware
 * Logs HTTP requests for monitoring and debugging
 */

export const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  const requestId = generateRequestId();

  // Attach request ID to request
  req.id = requestId;

  // Log request start
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Request ID: ${requestId}`);

  // Log request details in development
  if (process.env.NODE_ENV === 'development') {
    console.log('Request details:', {
      id: requestId,
      method: req.method,
      url: req.url,
      headers: sanitizeHeaders(req.headers),
      query: req.query,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      sessionId: req.headers['x-session-id'],
    });
  }

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - startTime;

    // Log response completion
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms - Request ID: ${requestId}`);

    // Log response details in development
    if (process.env.NODE_ENV === 'development') {
      console.log('Response details:', {
        requestId,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        contentLength: res.get('Content-Length'),
        contentType: res.get('Content-Type'),
      });
    }

    // Call original end
    originalEnd.call(this, chunk, encoding);
  };

  next();
};

/**
 * Performance logging middleware
 */
export const performanceLogger = (req, res, next) => {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds

    // Log slow requests (> 1 second)
    if (duration > 1000) {
      console.warn(`Slow request detected: ${req.method} ${req.url} - ${duration.toFixed(2)}ms`);
    }

    // Store performance metrics (could be sent to monitoring service)
    if (process.env.NODE_ENV === 'production') {
      // Here you could send metrics to your monitoring service
      // metrics.record('request_duration', duration, {
      //   method: req.method,
      //   route: req.route?.path,
      //   status: res.statusCode,
      // });
    }
  });

  next();
};

/**
 * Security logging middleware
 */
export const securityLogger = (req, res, next) => {
  // Log suspicious requests
  const suspiciousPatterns = [
    /\.\./,  // Path traversal
    /<script/i,  // XSS attempts
    /union.*select/i,  // SQL injection attempts
    /javascript:/i,  // JavaScript protocol
  ];

  const isSuspicious = suspiciousPatterns.some(pattern =>
    pattern.test(req.url) || pattern.test(JSON.stringify(req.query))
  );

  if (isSuspicious) {
    console.warn(`Suspicious request detected:`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      query: req.query,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
  }

  // Rate limiting violations
  res.on('finish', () => {
    if (res.statusCode === 429) {
      console.warn(`Rate limit exceeded:`, {
        ip: req.ip,
        url: req.url,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString(),
      });
    }
  });

  next();
};

/**
 * Error logging middleware
 */
export const errorLogger = (error, req, res, next) => {
  console.error('Request error:', {
    requestId: req.id,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    sessionId: req.sessionId,
    userId: req.user?.id,
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
    timestamp: new Date().toISOString(),
  });

  next(error);
};

/**
 * API usage logging middleware
 */
export const apiUsageLogger = (req, res, next) => {
  res.on('finish', () => {
    // Only log API endpoints
    if (req.path.startsWith('/api/')) {
      const usageData = {
        requestId: req.id,
        method: req.method,
        endpoint: req.path,
        statusCode: res.statusCode,
        sessionId: req.sessionId,
        userId: req.user?.id,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString(),
      };

      // Here you could store usage data in database or send to analytics
      console.log('API usage:', usageData);
    }
  });

  next();
};

/**
 * WebSocket connection logging
 */
export const websocketLogger = (ws, request) => {
  const connectionId = generateRequestId();
  ws.connectionId = connectionId;

  console.log(`WebSocket connection established: ${connectionId} from ${request.socket.remoteAddress}`);

  ws.on('close', (code, reason) => {
    console.log(`WebSocket connection closed: ${connectionId} - Code: ${code}, Reason: ${reason}`);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for connection ${connectionId}:`, error);
  });

  return connectionId;
};

/**
 * Utility functions
 */
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function sanitizeHeaders(headers) {
  const sanitized = { ...headers };

  // Remove sensitive headers
  delete sanitized.authorization;
  delete sanitized.cookie;
  delete sanitized['x-api-key'];

  return sanitized;
}

export default {
  requestLogger,
  performanceLogger,
  securityLogger,
  errorLogger,
  apiUsageLogger,
  websocketLogger,
};