import { AGUIProtocol } from '../../../src/backend/services/agui-protocol.js';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

// Mock WebSocket
jest.mock('ws');
jest.mock('../../../src/backend/database/connection.js');

describe('AG-UI Protocol Advanced Testing', () => {
  let protocol: AGUIProtocol;
  let mockWebSocket: jest.Mocked<WebSocket>;
  let eventEmitter: EventEmitter;

  beforeEach(() => {
    mockWebSocket = new WebSocket('ws://test') as jest.Mocked<WebSocket>;
    eventEmitter = new EventEmitter();

    protocol = new AGUIProtocol({
      maxRetries: 3,
      timeoutMs: 5000,
      enableCompression: true
    });

    // Mock WebSocket methods
    mockWebSocket.send = jest.fn();
    mockWebSocket.close = jest.fn();
    mockWebSocket.readyState = WebSocket.OPEN;
  });

  afterEach(() => {
    protocol.disconnect();
    eventEmitter.removeAllListeners();
  });

  describe('Event Protocol Validation', () => {
    it('should validate AG-UI event structure', async () => {
      const validEvent = {
        id: 'event-123',
        type: 'tool_input_request',
        timestamp: Date.now(),
        payload: {
          toolName: 'data-analyzer',
          parameters: { dataset: 'sales-data.csv' },
          uiConfig: {
            type: 'form',
            fields: ['dataset', 'analysisType']
          }
        },
        sessionId: 'session-456',
        agentId: 'agent-789'
      };

      const isValid = await protocol.validateEvent(validEvent);
      expect(isValid).toBe(true);
    });

    it('should reject invalid event structures', async () => {
      const invalidEvent = {
        type: 'invalid_event',
        payload: null
      };

      const isValid = await protocol.validateEvent(invalidEvent);
      expect(isValid).toBe(false);
    });

    it('should enforce event size limits', async () => {
      const largeEvent = {
        id: 'large-event',
        type: 'ui_update',
        timestamp: Date.now(),
        payload: {
          data: 'x'.repeat(1024 * 1024 + 1) // > 1MB
        }
      };

      await expect(protocol.sendEvent(largeEvent))
        .rejects.toThrow('Event payload too large');
    });
  });

  describe('Bidirectional Communication', () => {
    it('should handle agent-to-ui communication', async () => {
      const agentMessage = {
        id: 'agent-to-ui-123',
        type: 'ui_update',
        payload: {
          component: 'data-visualization',
          data: { chart: 'bar', values: [1, 2, 3, 4, 5] },
          actions: ['click', 'hover', 'filter']
        }
      };

      const responsePromise = protocol.sendEvent(agentMessage);

      // Simulate UI response
      setTimeout(() => {
        eventEmitter.emit('message', JSON.stringify({
          id: 'ui-response-123',
          type: 'ui_action',
          payload: {
            action: 'click',
            dataPoint: 3,
            timestamp: Date.now()
          },
          replyTo: 'agent-to-ui-123'
        }));
      }, 100);

      const response = await responsePromise;
      expect(response.type).toBe('ui_action');
      expect(response.payload.action).toBe('click');
    });

    it('should handle ui-to-agent communication', async () => {
      const uiMessage = {
        id: 'ui-to-agent-456',
        type: 'tool_input_request',
        payload: {
          toolName: 'file-processor',
          parameters: {
            filename: 'data.csv',
            operation: 'analyze'
          },
          userContext: {
            sessionId: 'session-789',
            preferences: { chartType: 'line' }
          }
        }
      };

      const agentResponse = await protocol.processUIRequest(uiMessage);

      expect(agentResponse).toHaveProperty('id');
      expect(agentResponse.type).toBe('tool_execution_result');
      expect(agentResponse.payload).toHaveProperty('result');
    });
  });

  describe('Real-time Data Synchronization', () => {
    it('should synchronize data across multiple UI instances', async () => {
      const instances = ['ui-1', 'ui-2', 'ui-3'];
      const dataUpdate = {
        id: 'sync-123',
        type: 'data_update',
        payload: {
          dataset: 'real-time-data',
          updates: [
            { id: 1, value: 100, timestamp: Date.now() },
            { id: 2, value: 200, timestamp: Date.now() }
          ]
        }
      };

      // Track which instances received the update
      const receivedUpdates: string[] = [];

      instances.forEach(instanceId => {
        protocol.subscribeToInstance(instanceId, (event) => {
          receivedUpdates.push(instanceId);
        });
      });

      await protocol.broadcastEvent(dataUpdate);

      // Wait for async delivery
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(receivedUpdates).toHaveLength(3);
      expect(receivedUpdates).toContain('ui-1');
      expect(receivedUpdates).toContain('ui-2');
      expect(receivedUpdates).toContain('ui-3');
    });

    it('should handle conflicting data updates', async () => {
      const conflictingUpdates = [
        {
          id: 'conflict-1',
          type: 'data_update',
          payload: { id: 1, value: 100, version: 1 }
        },
        {
          id: 'conflict-2',
          type: 'data_update',
          payload: { id: 1, value: 200, version: 2 }
        }
      ];

      const resolution = await protocol.resolveDataConflict(conflictingUpdates);

      expect(resolution).toHaveProperty('resolved');
      expect(resolution.payload.value).toBe(200); // Higher version wins
      expect(resolution.payload.version).toBe(2);
    });
  });

  describe('Session Management', () => {
    it('should maintain session state across multiple interactions', async () => {
      const sessionId = 'session-state-test';

      // Initialize session
      await protocol.createSession(sessionId, {
        userId: 'user-123',
        workflowId: 'workflow-456',
        preferences: { theme: 'dark', language: 'en' }
      });

      // Send multiple events in the same session
      const events = [
        { id: 'event-1', type: 'tool_input_request', payload: { step: 1 } },
        { id: 'event-2', type: 'ui_update', payload: { step: 2 } },
        { id: 'event-3', type: 'approval_request', payload: { step: 3 } }
      ];

      for (const event of events) {
        event.sessionId = sessionId;
        await protocol.sendEvent(event);
      }

      const sessionState = await protocol.getSessionState(sessionId);

      expect(sessionState.events).toHaveLength(3);
      expect(sessionState.currentStep).toBe(3);
      expect(sessionState.preferences.theme).toBe('dark');
    });

    it('should handle session expiration and cleanup', async () => {
      const sessionId = 'expiring-session';

      await protocol.createSession(sessionId, {
        userId: 'user-123',
        workflowId: 'workflow-456',
        ttl: 1000 // 1 second TTL
      });

      // Wait for session to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      await expect(protocol.getSessionState(sessionId))
        .rejects.toThrow('Session expired');

      // Verify cleanup
      const activeSessions = await protocol.getActiveSessions();
      expect(activeSessions).not.toContain(sessionId);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle WebSocket connection failures', async () => {
      mockWebSocket.send.mockImplementation(() => {
        throw new Error('Connection lost');
      });

      const event = {
        id: 'connection-test',
        type: 'ui_update',
        payload: { data: 'test' }
      };

      await expect(protocol.sendEvent(event))
        .rejects.toThrow('Connection lost');

      // Verify reconnection attempt
      expect(mockWebSocket.close).toHaveBeenCalled();
    });

    it('should implement exponential backoff for retries', async () => {
      let attemptCount = 0;
      mockWebSocket.send.mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary failure');
        }
        return true;
      });

      const event = {
        id: 'retry-test',
        type: 'ui_update',
        payload: { data: 'test' }
      };

      const startTime = Date.now();
      await protocol.sendEventWithRetry(event);
      const endTime = Date.now();

      expect(attemptCount).toBe(3);
      // Should have taken at least some time due to backoff
      expect(endTime - startTime).toBeGreaterThan(100);
    });

    it('should handle malformed messages gracefully', async () => {
      const malformedMessages = [
        'invalid json',
        '{"incomplete": "json"',
        '{"type": null, "payload": "invalid"}',
        '{"id": 123, "type": "valid", "payload": {"nested": null}}'
      ];

      for (const malformed of malformedMessages) {
        const result = await protocol.processMessage(malformed);
        expect(result.status).toBe('error');
        expect(result.error).toContain('Invalid message format');
      }
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle high-frequency events efficiently', async () => {
      const eventCount = 1000;
      const events = Array(eventCount).fill(null).map((_, i) => ({
        id: `perf-test-${i}`,
        type: 'ui_update',
        payload: { index: i, data: `test-data-${i}` }
      }));

      const startTime = performance.now();

      await Promise.all(events.map(event => protocol.sendEvent(event)));

      const endTime = performance.now();
      const duration = endTime - startTime;
      const eventsPerSecond = eventCount / (duration / 1000);

      // Should handle at least 100 events per second
      expect(eventsPerSecond).toBeGreaterThan(100);
    });

    it('should manage memory efficiently for large datasets', async () => {
      const largePayload = {
        id: 'memory-test',
        type: 'data_update',
        payload: {
          dataset: Array(10000).fill(null).map((_, i) => ({
            id: i,
            value: Math.random(),
            timestamp: Date.now()
          }))
        }
      };

      const initialMemory = process.memoryUsage().heapUsed;

      await protocol.sendEvent(largePayload);

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (< 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });

    it('should implement event batching for efficiency', async () => {
      const batchEvents = Array(100).fill(null).map((_, i) => ({
        id: `batch-${i}`,
        type: 'ui_update',
        payload: { batch: true, index: i }
      }));

      const startTime = performance.now();

      await protocol.sendBatchEvents(batchEvents, {
        batchSize: 20,
        flushInterval: 50
      });

      const endTime = performance.now();

      // Should be faster than sending individually
      expect(endTime - startTime).toBeLessThan(1000);

      // Verify all events were sent
      expect(mockWebSocket.send).toHaveBeenCalledTimes(5); // 100 events / 20 batch size
    });
  });

  describe('Security and Validation', () => {
    it('should sanitize event payloads to prevent XSS', async () => {
      const maliciousPayload = {
        id: 'security-test',
        type: 'ui_update',
        payload: {
          html: '<script>alert("XSS")</script>',
          javascript: 'javascript:alert("XSS")',
          data: '<img src="x" onerror="alert(\'XSS\')">'
        }
      };

      const sanitizedEvent = await protocol.sanitizeEvent(maliciousPayload);

      expect(sanitizedEvent.payload.html).not.toContain('<script>');
      expect(sanitizedEvent.payload.javascript).not.toContain('javascript:');
      expect(sanitizedEvent.payload.data).not.toContain('onerror');
    });

    it('should validate agent permissions', async () => {
      const restrictedEvent = {
        id: 'permission-test',
        type: 'system_config',
        payload: { config: 'restricted' },
        agentId: 'unauthorized-agent'
      };

      await expect(protocol.sendEvent(restrictedEvent))
        .rejects.toThrow('Insufficient permissions');
    });

    it('should implement rate limiting per agent', async () => {
      const agentId = 'rate-limited-agent';
      const events = Array(200).fill(null).map((_, i) => ({
        id: `rate-limit-${i}`,
        type: 'ui_update',
        payload: { data: i },
        agentId
      }));

      // Send events rapidly
      const results = await Promise.allSettled(
        events.map(event => protocol.sendEvent(event))
      );

      // Some events should be rate limited
      const rejected = results.filter(r => r.status === 'rejected');
      expect(rejected.length).toBeGreaterThan(0);

      rejected.forEach(result => {
        expect((result as PromiseRejectedResult).reason)
          .toContain('Rate limit exceeded');
      });
    });
  });

  describe('Protocol Extensions and Customization', () => {
    it('should support custom event types', async () => {
      const customEventType = 'custom_workflow_event';

      protocol.registerEventType(customEventType, {
        schema: {
          required: ['workflowId', 'step'],
          properties: {
            workflowId: { type: 'string' },
            step: { type: 'number' },
            metadata: { type: 'object' }
          }
        },
        handler: async (event) => {
          return { processed: true, workflowId: event.payload.workflowId };
        }
      });

      const customEvent = {
        id: 'custom-event-123',
        type: customEventType,
        payload: {
          workflowId: 'workflow-456',
          step: 3,
          metadata: { custom: 'data' }
        }
      };

      const result = await protocol.sendEvent(customEvent);
      expect(result.processed).toBe(true);
      expect(result.workflowId).toBe('workflow-456');
    });

    it('should support protocol versioning', async () => {
      const v1Event = {
        id: 'v1-event',
        type: 'ui_update',
        version: '1.0',
        payload: { data: 'legacy' }
      };

      const v2Event = {
        id: 'v2-event',
        type: 'ui_update',
        version: '2.0',
        payload: {
          data: 'modern',
          metadata: { enhanced: true }
        }
      };

      const v1Result = await protocol.processEvent(v1Event);
      const v2Result = await protocol.processEvent(v2Event);

      expect(v1Result.version).toBe('1.0');
      expect(v2Result.version).toBe('2.0');
      expect(v2Result.metadata).toBeDefined();
    });
  });
});