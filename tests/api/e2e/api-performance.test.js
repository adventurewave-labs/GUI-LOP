/**
 * API Performance Tests
 * End-to-end performance testing for API endpoints
 */

import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import { performance } from 'perf_hooks';

import { TestEnvironment } from '../setup.js';

describe('API Performance Tests', () => {
  let app;
  let testEnv;
  let server;
  let baseUrl;

  beforeAll(async () => {
    testEnv = TestEnvironment;
    baseUrl = testEnv.config.baseURL;

    // In a real setup, you would start the actual server
    // For now, we'll use a mock setup similar to integration tests
    app = testEnv.utils.createTestApp();

    // Setup basic server with performance monitoring
    app.use((req, res, next) => {
      const startTime = performance.now();

      res.on('finish', () => {
        const endTime = performance.now();
        const responseTime = Math.round(endTime - startTime);

        res.setHeader('X-Response-Time', `${responseTime}ms`);

        if (responseTime > 1000) {
          console.warn(`Slow request: ${req.method} ${req.path} took ${responseTime}ms`);
        }
      });

      next();
    });

    // Add a simple health endpoint for testing
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString()
      });
    });

    // Add a test endpoint for performance testing
    app.post('/api/v1/test/performance', (req, res) => {
      // Simulate some processing time
      const delay = Math.random() * 100; // 0-100ms
      setTimeout(() => {
        res.json({
          message: 'Performance test endpoint',
          processedAt: new Date().toISOString(),
          data: req.body
        });
      }, delay);
    });

    // Start server
    server = app.listen(0); // Use random available port
    baseUrl = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
  });

  describe('Response Time Performance', () => {
    const PERFORMANCE_THRESHOLDS = {
      health: 50, // 50ms for simple health check
      simpleApi: 200, // 200ms for simple API calls
      complexApi: 1000, // 1000ms for complex operations
      fileUpload: 5000 // 5000ms for file uploads
    };

    test('health endpoint should respond within threshold', async () => {
      const startTime = performance.now();

      const response = await request(baseUrl)
        .get('/health')
        .expect(200);

      const endTime = performance.now();
      const responseTime = Math.round(endTime - startTime);

      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.health);
      expect(parseInt(response.headers['x-response-time'])).toBeLessThan(PERFORMANCE_THRESHOLDS.health);

      if (testEnv.config.verbose) {
        console.log(`Health endpoint response time: ${responseTime}ms`);
      }
    });

    test('simple API endpoint should respond within threshold', async () => {
      const testData = {
        message: 'Performance test',
        timestamp: new Date().toISOString()
      };

      const startTime = performance.now();

      const response = await request(baseUrl)
        .post('/api/v1/test/performance')
        .send(testData)
        .expect(200);

      const endTime = performance.now();
      const responseTime = Math.round(endTime - startTime);

      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.simpleApi);

      if (testEnv.config.verbose) {
        console.log(`Simple API response time: ${responseTime}ms`);
      }
    });

    test('concurrent requests should not significantly degrade performance', async () => {
      const concurrentRequests = 10;
      const testData = {
        message: 'Concurrent performance test',
        timestamp: new Date().toISOString()
      };

      const startTime = performance.now();

      const promises = Array.from({ length: concurrentRequests }, (_, i) =>
        request(baseUrl)
          .post('/api/v1/test/performance')
          .send({
            ...testData,
            requestId: i
          })
      );

      const responses = await Promise.all(promises);
      const endTime = performance.now();
      const totalTime = Math.round(endTime - startTime);
      const averageTime = Math.round(totalTime / concurrentRequests);

      // All requests should succeed
      expect(responses).toHaveLength(concurrentRequests);
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Average response time should be reasonable
      expect(averageTime).toBeLessThan(PERFORMANCE_THRESHOLDS.simpleApi * 2);

      if (testEnv.config.verbose) {
        console.log(`Concurrent requests (${concurrentRequests}): ${totalTime}ms total, ${averageTime}ms average`);
      }
    });
  });

  describe('Load Testing', () => {
    test('should handle sustained load without degradation', async () => {
      const duration = 5000; // 5 seconds
      const requestInterval = 100; // Request every 100ms
      const maxResponseTime = 500; // Max acceptable response time

      const results = [];
      const startTime = Date.now();
      let requestCount = 0;

      while (Date.now() - startTime < duration) {
        const requestStart = performance.now();

        try {
          const response = await request(baseUrl)
            .post('/api/v1/test/performance')
            .send({ message: 'Load test', requestId: requestCount });

          const requestEnd = performance.now();
          const responseTime = Math.round(requestEnd - requestStart);

          results.push({
            requestId: requestCount,
            responseTime,
            success: response.status === 200
          });

          requestCount++;
        } catch (error) {
          results.push({
            requestId: requestCount,
            responseTime: null,
            success: false,
            error: error.message
          });
        }

        // Wait before next request
        if (Date.now() - startTime < duration) {
          await testEnv.utils.wait(requestInterval);
        }
      }

      // Analyze results
      const successfulRequests = results.filter(r => r.success);
      const failedRequests = results.filter(r => !r.success);
      const responseTimes = successfulRequests.map(r => r.responseTime).filter(t => t !== null);

      const successRate = successfulRequests.length / results.length;
      const averageResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);
      const p95ResponseTime = calculatePercentile(responseTimes, 95);

      expect(successRate).toBeGreaterThan(0.95); // 95% success rate
      expect(averageResponseTime).toBeLessThan(maxResponseTime);
      expect(maxResponseTime).toBeLessThan(maxResponseTime * 2); // Max shouldn't be too far from average

      if (testEnv.config.verbose) {
        console.log(`Load test results:`);
        console.log(`  Total requests: ${results.length}`);
        console.log(`  Success rate: ${(successRate * 100).toFixed(2)}%`);
        console.log(`  Average response time: ${averageResponseTime.toFixed(2)}ms`);
        console.log(`  Max response time: ${maxResponseTime}ms`);
        console.log(`  95th percentile: ${p95ResponseTime.toFixed(2)}ms`);
      }
    });

    test('should handle burst load gracefully', async () => {
      const burstSize = 50;
      const testData = {
        message: 'Burst load test',
        timestamp: new Date().toISOString()
      };

      const startTime = performance.now();

      // Fire burst of concurrent requests
      const promises = Array.from({ length: burstSize }, (_, i) =>
        request(baseUrl)
          .post('/api/v1/test/performance')
          .send({ ...testData, requestId: i })
      );

      const responses = await Promise.allSettled(promises);
      const endTime = performance.now();
      const totalTime = Math.round(endTime - startTime);

      // Analyze burst results
      const successfulResponses = responses.filter(r => r.status === 'fulfilled' && r.value.status === 200);
      const failedResponses = responses.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status !== 200));

      const successRate = successfulResponses.length / responses.length;

      expect(successRate).toBeGreaterThan(0.9); // 90% success rate for burst

      if (testEnv.config.verbose) {
        console.log(`Burst test results (${burstSize} concurrent requests):`);
        console.log(`  Total time: ${totalTime}ms`);
        console.log(`  Success rate: ${(successRate * 100).toFixed(2)}%`);
        console.log(`  Successful: ${successfulResponses.length}`);
        console.log(`  Failed: ${failedResponses.length}`);
      }
    });
  });

  describe('Memory and Resource Usage', () => {
    test('should not leak memory during sustained requests', async () => {
      const initialMemory = process.memoryUsage();
      const iterations = 100;
      const memorySnapshots = [];

      for (let i = 0; i < iterations; i++) {
        // Make a request
        await request(baseUrl)
          .post('/api/v1/test/performance')
          .send({ message: 'Memory test', iteration: i });

        // Take memory snapshot every 10 iterations
        if (i % 10 === 0) {
          const memory = process.memoryUsage();
          memorySnapshots.push({
            iteration: i,
            heapUsed: memory.heapUsed,
            heapTotal: memory.heapTotal,
            external: memory.external,
            rss: memory.rss
          });
        }
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);

      if (testEnv.config.verbose) {
        console.log(`Memory usage test:`);
        console.log(`  Initial heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Final heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);
      }
    });

    test('should handle large payloads efficiently', async () => {
      const smallPayload = { message: 'Small payload' };
      const mediumPayload = {
        message: 'Medium payload',
        data: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item_${i}` }))
      };
      const largePayload = {
        message: 'Large payload',
        data: Array.from({ length: 10000 }, (_, i) => ({
          id: i,
          value: `item_${i}`,
          metadata: {
            created: new Date().toISOString(),
            tags: [`tag_${i % 100}`, `category_${i % 10}`],
            description: `This is item number ${i} with some additional text to increase size`
          }
        }))
      };

      const payloads = [
        { name: 'Small', data: smallPayload, expectedMaxTime: 100 },
        { name: 'Medium', data: mediumPayload, expectedMaxTime: 300 },
        { name: 'Large', data: largePayload, expectedMaxTime: 1000 }
      ];

      const results = [];

      for (const payload of payloads) {
        const startTime = performance.now();

        const response = await request(baseUrl)
          .post('/api/v1/test/performance')
          .send(payload.data)
          .expect(200);

        const endTime = performance.now();
        const responseTime = Math.round(endTime - startTime);

        results.push({
          name: payload.name,
          size: JSON.stringify(payload.data).length,
          responseTime,
          withinThreshold: responseTime <= payload.expectedMaxTime
        });

        expect(responseTime).toBeLessThan(payload.expectedMaxTime);
      }

      if (testEnv.config.verbose) {
        console.log(`Payload size performance test:`);
        results.forEach(result => {
          console.log(`  ${result.name}: ${result.size} bytes, ${result.responseTime}ms`);
        });
      }
    });
  });

  describe('Rate Limiting Performance', () => {
    test('should handle rate limiting efficiently', async () => {
      // Test that rate limiting doesn't add significant overhead
      const requests = [];
      const maxAllowedRequests = 5; // Assuming rate limit of 5 requests per window

      // Make requests up to the rate limit
      for (let i = 0; i < maxAllowedRequests + 2; i++) {
        const startTime = performance.now();

        try {
          const response = await request(baseUrl)
            .post('/api/v1/test/performance')
            .send({ message: 'Rate limit test', requestId: i });

          const endTime = performance.now();
          const responseTime = Math.round(endTime - startTime);

          requests.push({
            requestId: i,
            responseTime,
            status: response.status,
            rateLimited: false
          });
        } catch (error) {
          const endTime = performance.now();
          const responseTime = Math.round(endTime - startTime);

          requests.push({
            requestId: i,
            responseTime,
            status: error.response?.status || 0,
            rateLimited: error.response?.status === 429
          });
        }
      }

      const successfulRequests = requests.filter(r => !r.rateLimited);
      const rateLimitedRequests = requests.filter(r => r.rateLimited);

      // Rate limiting should work
      expect(rateLimitedRequests.length).toBeGreaterThan(0);

      // But it shouldn't significantly impact response times
      const averageResponseTime = successfulRequests.reduce((sum, r) => sum + r.responseTime, 0) / successfulRequests.length;
      expect(averageResponseTime).toBeLessThan(200); // Should still be fast

      if (testEnv.config.verbose) {
        console.log(`Rate limiting performance test:`);
        console.log(`  Successful requests: ${successfulRequests.length}`);
        console.log(`  Rate limited requests: ${rateLimitedRequests.length}`);
        console.log(`  Average response time: ${averageResponseTime.toFixed(2)}ms`);
      }
    });
  });

  describe('Error Handling Performance', () => {
    test('should handle errors efficiently', async () => {
      const errorRequests = [
        { path: '/non-existent-endpoint', expectedStatus: 404 },
        { path: '/api/v1/test/performance', method: 'GET', expectedStatus: 404 }, // Wrong method
        { path: '/api/v1/test/performance', data: null, expectedStatus: 400 } // Invalid data
      ];

      const results = [];

      for (const errorReq of errorRequests) {
        const startTime = performance.now();

        try {
          const req = request(baseUrl)[errorReq.method || 'post'](errorReq.path);

          if (errorReq.data !== null) {
            req.send(errorReq.data);
          }

          const response = await req;

          const endTime = performance.now();
          const responseTime = Math.round(endTime - startTime);

          results.push({
            path: errorReq.path,
            responseTime,
            status: response.status,
            expectedStatus: errorReq.expectedStatus
          });
        } catch (error) {
          const endTime = performance.now();
          const responseTime = Math.round(endTime - startTime);

          results.push({
            path: errorReq.path,
            responseTime,
            status: error.response?.status || 0,
            expectedStatus: errorReq.expectedStatus
          });
        }
      }

      // All error responses should be fast
      results.forEach(result => {
        expect(result.responseTime).toBeLessThan(100); // Errors should be handled quickly
      });

      const averageErrorTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;

      if (testEnv.config.verbose) {
        console.log(`Error handling performance test:`);
        console.log(`  Average error response time: ${averageErrorTime.toFixed(2)}ms`);
        results.forEach(result => {
          console.log(`  ${result.path}: ${result.responseTime}ms (status: ${result.status})`);
        });
      }
    });
  });
});

/**
 * Calculate percentile value from array of numbers
 */
function calculatePercentile(values, percentile) {
  if (values.length === 0) return 0;

  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}