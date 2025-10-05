import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import WebSocket from 'ws';
import { createTestServer } from '../../helpers/test-server.js';
import { mockAGUIEvents } from '../../fixtures/mock-data.js';

describe('AG-UI Protocol Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  let wsUrl: string;

  beforeAll(async () => {
    const testServer = await createTestServer();
    server = testServer.server;
    baseUrl = `http://localhost:${testServer.port}`;
    wsUrl = `ws://localhost:${testServer.port}/ws`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  describe('HTTP API Endpoints', () => {
    it('should handle tool input requests via REST API', async () => {
      const toolInputRequest = mockAGUIEvents.toolInputRequest;

      const response = await request(baseUrl)
        .post('/api/events/tool-input-request')
        .send(toolInputRequest)
        .expect(200);

      expect(response.body.type).toBe('tool_input_response');
      expect(response.body.payload.requestId).toBe(toolInputRequest.payload.requestId);
      expect(response.body.payload.status).toBe('queued');
    });

    it('should validate incoming event structure', async () => {
      const invalidEvent = {
        type: 'tool_input_request',
        // Missing required fields
      };

      const response = await request(baseUrl)
        .post('/api/events/tool-input-request')
        .send(invalidEvent)
        .expect(400);

      expect(response.body.error).toContain('Invalid event structure');
    });

    it('should handle UI update events', async () => {
      const uiUpdate = mockAGUIEvents.uiUpdate;

      const response = await request(baseUrl)
        .post('/api/events/ui-update')
        .send(uiUpdate)
        .expect(200);

      expect(response.body.type).toBe('ui_update_acknowledgment');
      expect(response.body.payload.componentId).toBe(uiUpdate.payload.componentId);
    });

    it('should handle approval request events', async () => {
      const approvalRequest = mockAGUIEvents.approvalRequest;

      const response = await request(baseUrl)
        .post('/api/events/approval-request')
        .send(approvalRequest)
        .expect(200);

      expect(response.body.type).toBe('approval_request_queued');
      expect(response.body.payload.workflowId).toBe(approvalRequest.payload.workflowId);
    });

    it('should rate limit excessive requests', async () => {
      const event = mockAGUIEvents.toolInputRequest;

      // Send many requests quickly
      const requests = Array(10).fill(null).map(() =>
        request(baseUrl)
          .post('/api/events/tool-input-request')
          .send(event)
      );

      const responses = await Promise.all(requests);

      // Should handle rate limiting gracefully
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it('should handle concurrent event processing', async () => {
      const events = [
        mockAGUIEvents.toolInputRequest,
        mockAGUIEvents.uiUpdate,
        mockAGUIEvents.approvalRequest,
      ];

      const requests = events.map(event =>
        request(baseUrl)
          .post('/api/events')
          .send(event)
      );

      const responses = await Promise.all(requests);

      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.type).toContain(events[index].type);
      });
    });
  });

  describe('WebSocket Communication', () => {
    let ws: WebSocket;

    beforeEach(() => {
      ws = new WebSocket(wsUrl);
    });

    afterEach(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    it('should establish WebSocket connection', async () => {
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          expect(ws.readyState).toBe(WebSocket.OPEN);
          resolve();
        });
        ws.on('error', reject);
      });
    });

    it('should handle session initialization', async () => {
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          const initMessage = {
            type: 'session_init',
            payload: { sessionId: 'test-session-123' },
          };
          ws.send(JSON.stringify(initMessage));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          expect(message.type).toBe('session_initialized');
          expect(message.payload.sessionId).toBe('test-session-123');
          resolve();
        });

        ws.on('error', reject);
      });
    });

    it('should process real-time events via WebSocket', async () => {
      const event = mockAGUIEvents.uiUpdate;

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          // Initialize session
          ws.send(JSON.stringify({
            type: 'session_init',
            payload: { sessionId: 'test-session-456' },
          }));

          // Send event
          ws.send(JSON.stringify(event));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'session_initialized') {
            return; // Skip initialization message
          }

          expect(message.type).toBe('ui_update_acknowledgment');
          expect(message.payload.componentId).toBe(event.payload.componentId);
          resolve();
        });

        ws.on('error', reject);
      });
    });

    it('should handle bidirectional communication', async () => {
      const toolInputRequest = mockAGUIEvents.toolInputRequest;

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'session_init',
            payload: { sessionId: 'test-session-789' },
          }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'session_initialized') {
            // Send tool input request
            ws.send(JSON.stringify(toolInputRequest));
          } else if (message.type === 'tool_input_response') {
            // Send back input response
            const response = {
              type: 'tool_input_response',
              payload: {
                requestId: toolInputRequest.payload.requestId,
                inputData: { parameter1: 'test_value' },
              },
            };
            ws.send(JSON.stringify(response));
          } else if (message.type === 'input_processed') {
            expect(message.payload.requestId).toBe(toolInputRequest.payload.requestId);
            expect(message.payload.success).toBe(true);
            resolve();
          }
        });

        ws.on('error', reject);
      });
    });

    it('should handle WebSocket reconnection', async () => {
      let reconnectCount = 0;

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'session_init',
            payload: { sessionId: 'test-session-reconnect' },
          }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'session_initialized') {
            // Close connection
            ws.close();
          }
        });

        ws.on('close', () => {
          reconnectCount++;
          if (reconnectCount === 1) {
            // Create new connection
            const newWs = new WebSocket(wsUrl);

            newWs.on('open', () => {
              newWs.send(JSON.stringify({
                type: 'session_init',
                payload: { sessionId: 'test-session-reconnect' },
              }));
            });

            newWs.on('message', (data) => {
              const message = JSON.parse(data.toString());
              if (message.type === 'session_initialized') {
                expect(message.payload.sessionId).toBe('test-session-reconnect');
                resolve();
              }
            });

            newWs.on('error', reject);
          }
        });

        ws.on('error', reject);
      });
    });

    it('should handle connection timeouts', async () => {
      const wsTimeout = new WebSocket(wsUrl);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          wsTimeout.close();
          resolve();
        }, 100);

        wsTimeout.on('error', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    });
  });

  describe('Event Processing Pipeline', () => {
    it('should process events in correct order', async () => {
      const events = [
        mockAGUIEvents.toolInputRequest,
        mockAGUIEvents.uiUpdate,
        mockAGUIEvents.approvalRequest,
      ];

      const responses = [];

      for (const event of events) {
        const response = await request(baseUrl)
          .post('/api/events')
          .send(event);

        responses.push(response.body);
      }

      // Verify events were processed in order
      expect(responses[0].type).toBe('tool_input_response');
      expect(responses[1].type).toBe('ui_update_acknowledgment');
      expect(responses[2].type).toBe('approval_request_queued');
    });

    it('should handle event dependencies', async () => {
      // First create a workflow session
      const sessionResponse = await request(baseUrl)
        .post('/api/workflows/session')
        .send({
          workflowId: 'workflow-123',
          userId: 'user-123',
        })
        .expect(201);

      const sessionId = sessionResponse.body.sessionId;

      // Send approval request for this session
      const approvalRequest = {
        ...mockAGUIEvents.approvalRequest,
        sessionId,
        payload: {
          ...mockAGUIEvents.approvalRequest.payload,
          workflowId: 'workflow-123',
        },
      };

      const response = await request(baseUrl)
        .post('/api/events/approval-request')
        .send(approvalRequest)
        .expect(200);

      expect(response.body.payload.sessionId).toBe(sessionId);
      expect(response.body.payload.dependenciesMet).toBe(true);
    });

    it('should handle event state persistence', async () => {
      const event = mockAGUIEvents.uiUpdate;

      // Send event
      const response = await request(baseUrl)
        .post('/api/events/ui-update')
        .send(event)
        .expect(200);

      const eventId = response.body.payload.eventId;

      // Check if event was stored
      const storedEvent = await request(baseUrl)
        .get(`/api/events/${eventId}`)
        .expect(200);

      expect(storedEvent.body.type).toBe(event.type);
      expect(storedEvent.body.payload.componentId).toBe(event.payload.componentId);
    });

    it('should handle event expiration', async () => {
      const expiredEvent = {
        ...mockAGUIEvents.approvalRequest,
        timestamp: Date.now() - 3600000, // 1 hour ago
        payload: {
          ...mockAGUIEvents.approvalRequest.payload,
          timeout: 300000, // 5 minutes
        },
      };

      const response = await request(baseUrl)
        .post('/api/events/approval-request')
        .send(expiredEvent)
        .expect(400);

      expect(response.body.error).toContain('Event expired');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON in WebSocket messages', async () => {
      const ws = new WebSocket(wsUrl);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          // Send malformed JSON
          ws.send('invalid json');
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          expect(message.type).toBe('error');
          expect(message.payload.error).toContain('Invalid JSON');
          resolve();
        });

        ws.on('error', reject);
      });
    });

    it('should handle unknown event types', async () => {
      const unknownEvent = {
        type: 'unknown_event',
        payload: { data: 'test' },
        timestamp: Date.now(),
      };

      const response = await request(baseUrl)
        .post('/api/events')
        .send(unknownEvent)
        .expect(400);

      expect(response.body.error).toContain('Unknown event type');
    });

    it('should handle database connection failures', async () => {
      // This test assumes the test server can simulate database failures
      const event = mockAGUIEvents.uiUpdate;

      const response = await request(baseUrl)
        .post('/api/events/ui-update')
        .set('X-Simulate-DB-Failure', 'true')
        .send(event)
        .expect(503);

      expect(response.body.error).toContain('Database connection failed');
    });

    it('should handle WebSocket connection limits', async () => {
      const connections = Array(100).fill(null).map(() => new WebSocket(wsUrl));

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          connections.forEach(ws => ws.close());
          resolve();
        }, 100);
      });
    });
  });

  describe('Performance', () => {
    it('should handle high event throughput', async () => {
      const eventCount = 100;
      const events = Array(eventCount).fill(null).map((_, i) => ({
        ...mockAGUIEvents.uiUpdate,
        payload: {
          ...mockAGUIEvents.uiUpdate.payload,
          componentId: `component-${i}`,
        },
      }));

      const startTime = Date.now();

      const promises = events.map(event =>
        request(baseUrl)
          .post('/api/events/ui-update')
          .send(event)
      );

      const responses = await Promise.all(promises);
      const endTime = Date.now();

      expect(responses.every(r => r.status === 200)).toBe(true);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete in under 5 seconds
    });

    it('should maintain low latency for real-time events', async () => {
      const ws = new WebSocket(wsUrl);

      try {
        await new Promise<void>((resolve, reject) => {
          const startTime = Date.now();

          ws.on('open', () => {
            ws.send(JSON.stringify({
              type: 'session_init',
              payload: { sessionId: 'performance-test' },
            }));

            ws.send(JSON.stringify(mockAGUIEvents.uiUpdate));
          });

          ws.on('message', (data) => {
            const message = JSON.parse(data.toString());

            if (message.type === 'session_initialized') {
              return;
            }

            const latency = Date.now() - startTime;
            expect(latency).toBeLessThan(100); // Should be under 100ms
            resolve();
          });

          ws.on('error', reject);
        });
      } finally {
        ws.close();
      }
    });
  });
});