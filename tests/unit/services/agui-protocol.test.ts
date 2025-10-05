import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AGUIProtocolService } from '../../../src/backend/services/agui-protocol.js';
import { mockAGUIEvents } from '../../fixtures/mock-data.js';

describe('AGUIProtocolService', () => {
  let aguiService: AGUIProtocolService;
  let mockLogger: any;
  let mockEventBus: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    mockEventBus = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    aguiService = new AGUIProtocolService(mockLogger, mockEventBus);
  });

  describe('Event Validation', () => {
    it('should validate tool input request events', () => {
      const event = mockAGUIEvents.toolInputRequest;

      const result = aguiService.validateEvent(event);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject events with missing required fields', () => {
      const invalidEvent = {
        type: 'tool_input_request',
        // Missing payload
        timestamp: Date.now(),
      };

      const result = aguiService.validateEvent(invalidEvent);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required field: payload');
    });

    it('should validate event payload structure', () => {
      const event = {
        type: 'tool_input_request',
        payload: {
          requestId: 'req-123',
          toolName: 'data_visualizer',
          // Missing parameters
        },
        timestamp: Date.now(),
      };

      const result = aguiService.validateEvent(event);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required parameter: parameters');
    });

    it('should handle unknown event types', () => {
      const unknownEvent = {
        type: 'unknown_event',
        payload: { data: 'test' },
        timestamp: Date.now(),
      };

      const result = aguiService.validateEvent(unknownEvent);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Unknown event type: unknown_event');
    });
  });

  describe('Event Processing', () => {
    it('should process tool input request events', async () => {
      const event = mockAGUIEvents.toolInputRequest;

      const result = await aguiService.processEvent(event);

      expect(result.type).toBe('tool_input_response');
      expect(result.payload.requestId).toBe(event.payload.requestId);
      expect(result.payload.status).toBe('processed');
      expect(mockEventBus.emit).toHaveBeenCalledWith('tool_input_processed', result);
    });

    it('should process UI update events', async () => {
      const event = mockAGUIEvents.uiUpdate;

      const result = await aguiService.processEvent(event);

      expect(result.type).toBe('ui_update_acknowledgment');
      expect(result.payload.componentId).toBe(event.payload.componentId);
      expect(result.payload.updateId).toBeDefined();
    });

    it('should process approval request events', async () => {
      const event = mockAGUIEvents.approvalRequest;

      const result = await aguiService.processEvent(event);

      expect(result.type).toBe('approval_request_queued');
      expect(result.payload.workflowId).toBe(event.payload.workflowId);
      expect(result.payload.requestId).toBeDefined();
      expect(result.payload.expiry).toBeGreaterThan(Date.now());
    });

    it('should handle processing errors gracefully', async () => {
      const malformedEvent = {
        type: 'tool_input_request',
        payload: null,
        timestamp: Date.now(),
      };

      const result = await aguiService.processEvent(malformedEvent);

      expect(result.type).toBe('error');
      expect(result.payload.error).toContain('Event processing failed');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Event Queue Management', () => {
    it('should queue events for later processing', async () => {
      const event = mockAGUIEvents.uiUpdate;

      await aguiService.queueEvent(event);

      expect(aguiService.getQueueSize()).toBe(1);
      expect(aguiService.isQueued(event.payload.componentId)).toBe(true);
    });

    it('should process queued events in FIFO order', async () => {
      const event1 = { ...mockAGUIEvents.uiUpdate, payload: { ...mockAGUIEvents.uiUpdate.payload, componentId: 'comp-1' } };
      const event2 = { ...mockAGUIEvents.uiUpdate, payload: { ...mockAGUIEvents.uiUpdate.payload, componentId: 'comp-2' } };

      await aguiService.queueEvent(event1);
      await aguiService.queueEvent(event2);

      const processedEvents = [];
      aguiService.on('event_processed', (event) => processedEvents.push(event));

      await aguiService.processQueue();

      expect(processedEvents).toHaveLength(2);
      expect(processedEvents[0].payload.componentId).toBe('comp-1');
      expect(processedEvents[1].payload.componentId).toBe('comp-2');
    });

    it('should handle queue overflow', async () => {
      // Simulate queue overflow
      for (let i = 0; i < 1005; i++) {
        const event = { ...mockAGUIEvents.uiUpdate, payload: { ...mockAGUIEvents.uiUpdate.payload, componentId: `comp-${i}` } };
        await aguiService.queueEvent(event);
      }

      expect(aguiService.getQueueSize()).toBeLessThanOrEqual(1000);
      expect(mockLogger.warn).toHaveBeenCalledWith('Event queue overflow detected');
    });
  });

  describe('Event Subscription', () => {
    it('should subscribe to specific event types', () => {
      const callback = jest.fn();

      aguiService.subscribe('ui_update', callback);

      expect(mockEventBus.on).toHaveBeenCalledWith('ui_update', callback);
    });

    it('should unsubscribe from event types', () => {
      const callback = jest.fn();

      aguiService.subscribe('ui_update', callback);
      aguiService.unsubscribe('ui_update', callback);

      expect(mockEventBus.off).toHaveBeenCalledWith('ui_update', callback);
    });

    it('should handle subscription errors', () => {
      const invalidCallback = 'not-a-function';

      expect(() => {
        aguiService.subscribe('ui_update', invalidCallback);
      }).toThrow('Callback must be a function');
    });
  });

  describe('Event Filtering', () => {
    it('should filter events by type', () => {
      const events = [mockAGUIEvents.toolInputRequest, mockAGUIEvents.uiUpdate, mockAGUIEvents.approvalRequest];

      const filteredEvents = aguiService.filterEventsByType(events, 'ui_update');

      expect(filteredEvents).toHaveLength(1);
      expect(filteredEvents[0].type).toBe('ui_update');
    });

    it('should filter events by timestamp range', () => {
      const now = Date.now();
      const events = [
        mockAGUIEvents.toolInputRequest,
        { ...mockAGUIEvents.uiUpdate, timestamp: now - 5000 },
        { ...mockAGUIEvents.approvalRequest, timestamp: now + 5000 },
      ];

      const recentEvents = aguiService.filterEventsByTimestamp(events, now - 1000, now + 1000);

      expect(recentEvents).toHaveLength(2);
    });

    it('should filter events by session ID', () => {
      const events = [
        { ...mockAGUIEvents.toolInputRequest, sessionId: 'session-1' },
        { ...mockAGUIEvents.uiUpdate, sessionId: 'session-2' },
        { ...mockAGUIEvents.approvalRequest, sessionId: 'session-1' },
      ];

      const sessionEvents = aguiService.filterEventsBySession(events, 'session-1');

      expect(sessionEvents).toHaveLength(2);
      expect(sessionEvents.every(e => e.sessionId === 'session-1')).toBe(true);
    });
  });

  describe('Performance Monitoring', () => {
    it('should track event processing time', async () => {
      const event = mockAGUIEvents.toolInputRequest;

      const result = await aguiService.processEvent(event);

      expect(result.processingTime).toBeDefined();
      expect(result.processingTime).toBeGreaterThan(0);
      expect(result.processingTime).toBeLessThan(1000);
    });

    it('should track queue processing statistics', async () => {
      const events = [mockAGUIEvents.toolInputRequest, mockAGUIEvents.uiUpdate];

      for (const event of events) {
        await aguiService.queueEvent(event);
      }

      await aguiService.processQueue();

      const stats = aguiService.getProcessingStats();

      expect(stats.totalProcessed).toBe(2);
      expect(stats.averageProcessingTime).toBeGreaterThan(0);
      expect(stats.successRate).toBe(1.0);
    });

    it('should handle performance degradation', async () => {
      // Simulate slow processing
      const slowEvent = mockAGUIEvents.toolInputRequest;
      jest.spyOn(aguiService, 'processEvent').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return { type: 'processed', payload: {} };
      });

      const result = await aguiService.processEvent(slowEvent);

      expect(result.processingTime).toBeGreaterThan(1500);
      expect(result.performanceWarning).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith('Slow event processing detected');
    });
  });

  describe('Security', () => {
    it('should sanitize event payloads', async () => {
      const maliciousEvent = {
        type: 'tool_input_request',
        payload: {
          requestId: 'req-123',
          toolName: 'test_tool',
          parameters: {
            input: '<script>alert("XSS")</script>',
          },
        },
        timestamp: Date.now(),
      };

      const result = await aguiService.processEvent(maliciousEvent);

      expect(result.payload.parameters.input).not.toContain('<script>');
      expect(result.payload.parameters.input).toBe('&lt;script&gt;alert("XSS")&lt;/script&gt;');
    });

    it('should validate event size limits', () => {
      const largeEvent = {
        type: 'ui_update',
        payload: {
          data: 'x'.repeat(1024 * 1024), // 1MB payload
        },
        timestamp: Date.now(),
      };

      const result = aguiService.validateEvent(largeEvent);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Event payload too large');
    });

    it('should detect and prevent event injection attacks', () => {
      const injectionEvent = {
        type: 'tool_input_request"; DROP TABLE events; --',
        payload: { test: 'data' },
        timestamp: Date.now(),
      };

      const result = aguiService.validateEvent(injectionEvent);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid event type detected');
    });
  });
});