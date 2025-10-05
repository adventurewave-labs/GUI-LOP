/**
 * AG-UI Protocol Event Service
 * Handles standardized communication between agent backend and dynamic frontend
 */

export const AGUI_EVENTS = {
  // Core protocol events
  UI_UPDATE: 'ui_update',
  TOOL_INPUT_REQUEST: 'tool_input_request',
  TOOL_INPUT_RESPONSE: 'tool_input_response',
  APPROVAL_REQUEST: 'approval_request',
  APPROVAL_RESPONSE: 'approval_response',
  DATA_DISPLAY: 'data_display',
  WORKFLOW_STATE: 'workflow_state',
  ERROR: 'error',
  STATUS: 'status',

  // Workflow control events
  WORKFLOW_START: 'workflow_start',
  WORKFLOW_PAUSE: 'workflow_pause',
  WORKFLOW_RESUME: 'workflow_resume',
  WORKFLOW_COMPLETE: 'workflow_complete',
  WORKFLOW_CANCEL: 'workflow_cancel',

  // Data exchange events
  DATA_REQUEST: 'data_request',
  DATA_RESPONSE: 'data_response',
  STREAM_DATA: 'stream_data',

  // UI interaction events
  UI_INTERACTION: 'ui_interaction',
  FORM_SUBMIT: 'form_submit',
  SELECTION_CHANGE: 'selection_change',
  NAVIGATION: 'navigation'
};

export class AGUIEventService {
  constructor() {
    this.eventHandlers = new Map();
    this.eventHistory = [];
    this.isDebugMode = process.env.NODE_ENV === 'development';
  }

  /**
   * Register an event handler for a specific event type
   */
  registerEventHandler(eventType, handler) {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType).push(handler);

    // Return unregister function
    return () => {
      const handlers = this.eventHandlers.get(eventType);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Emit an event to all registered handlers
   */
  emit(event) {
    if (!event || !event.type) {
      console.error('Invalid event:', event);
      return;
    }

    // Add timestamp if not present
    if (!event.timestamp) {
      event.timestamp = new Date().toISOString();
    }

    // Add to history
    this.eventHistory.push({ ...event, id: this.generateEventId() });

    // Keep history size manageable
    if (this.eventHistory.length > 1000) {
      this.eventHistory = this.eventHistory.slice(-500);
    }

    if (this.isDebugMode) {
      console.log('AGUI Event Emitted:', event);
    }

    // Notify all handlers for this event type
    const handlers = this.eventHandlers.get(event.type) || [];
    handlers.forEach(handler => {
      try {
        handler(event);
      } catch (error) {
        console.error(`Error in event handler for ${event.type}:`, error);
      }
    });

    // Also notify wildcard handlers
    const wildcardHandlers = this.eventHandlers.get('*') || [];
    wildcardHandlers.forEach(handler => {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in wildcard event handler:', error);
      }
    });
  }

  /**
   * Create standardized AG-UI events
   */
  createUIUpdateEvent(sessionId, payload = {}) {
    return {
      type: AGUI_EVENTS.UI_UPDATE,
      sessionId,
      payload: {
        timestamp: new Date().toISOString(),
        ...payload
      }
    };
  }

  createToolInputRequestEvent(sessionId, toolId, toolConfig, inputSchema) {
    return {
      type: AGUI_EVENTS.TOOL_INPUT_REQUEST,
      sessionId,
      payload: {
        toolId,
        toolConfig,
        inputSchema,
        timestamp: new Date().toISOString(),
        requestId: this.generateEventId()
      }
    };
  }

  createApprovalRequestEvent(sessionId, message, options = {}) {
    return {
      type: AGUI_EVENTS.APPROVAL_REQUEST,
      sessionId,
      payload: {
        message,
        options,
        timestamp: new Date().toISOString(),
        requestId: this.generateEventId(),
        timeout: options.timeout || 30000 // 30 seconds default
      }
    };
  }

  createDataDisplayEvent(sessionId, data, displayConfig = {}) {
    return {
      type: AGUI_EVENTS.DATA_DISPLAY,
      sessionId,
      payload: {
        data,
        displayConfig,
        timestamp: new Date().toISOString(),
        requestId: this.generateEventId()
      }
    };
  }

  createWorkflowStateEvent(sessionId, state, step, metadata = {}) {
    return {
      type: AGUI_EVENTS.WORKFLOW_STATE,
      sessionId,
      payload: {
        state,
        step,
        metadata,
        timestamp: new Date().toISOString()
      }
    };
  }

  createErrorEvent(sessionId, error, context = {}) {
    return {
      type: AGUI_EVENTS.ERROR,
      sessionId,
      payload: {
        error: {
          message: error.message || error,
          stack: error.stack,
          code: error.code
        },
        context,
        timestamp: new Date().toISOString()
      }
    };
  }

  createStatusEvent(sessionId, status, details = {}) {
    return {
      type: AGUI_EVENTS.STATUS,
      sessionId,
      payload: {
        status,
        details,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Validate AG-UI event structure
   */
  validateEvent(event) {
    const requiredFields = ['type', 'sessionId'];
    const missingFields = requiredFields.filter(field => !event[field]);

    if (missingFields.length > 0) {
      return {
        valid: false,
        error: `Missing required fields: ${missingFields.join(', ')}`
      };
    }

    if (!Object.values(AGUI_EVENTS).includes(event.type)) {
      return {
        valid: false,
        error: `Unknown event type: ${event.type}`
      };
    }

    return { valid: true };
  }

  /**
   * Get event history with filtering
   */
  getEventHistory(filters = {}) {
    let history = [...this.eventHistory];

    if (filters.eventType) {
      history = history.filter(event => event.type === filters.eventType);
    }

    if (filters.sessionId) {
      history = history.filter(event => event.sessionId === filters.sessionId);
    }

    if (filters.since) {
      const since = new Date(filters.since);
      history = history.filter(event => new Date(event.timestamp) >= since);
    }

    if (filters.limit) {
      history = history.slice(-filters.limit);
    }

    return history;
  }

  /**
   * Clear event history
   */
  clearHistory(sessionId = null) {
    if (sessionId) {
      this.eventHistory = this.eventHistory.filter(event => event.sessionId !== sessionId);
    } else {
      this.eventHistory = [];
    }
  }

  /**
   * Generate unique event ID
   */
  generateEventId() {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get event statistics
   */
  getEventStats(sessionId = null) {
    const events = sessionId
      ? this.eventHistory.filter(event => event.sessionId === sessionId)
      : this.eventHistory;

    const stats = {
      total: events.length,
      byType: {},
      byHour: {},
      recentActivity: events.slice(-10)
    };

    events.forEach(event => {
      // Count by type
      stats.byType[event.type] = (stats.byType[event.type] || 0) + 1;

      // Count by hour
      const hour = new Date(event.timestamp).getHours();
      stats.byHour[hour] = (stats.byHour[hour] || 0) + 1;
    });

    return stats;
  }
}

// Singleton instance
export const aguiEventService = new AGUIEventService();

/**
 * React hook for AG-UI event handling
 */
export const useAGUIEvents = (sessionId) => {
  const [eventHistory, setEventHistory] = React.useState([]);
  const [latestEvent, setLatestEvent] = React.useState(null);

  React.useEffect(() => {
    const handleEvent = (event) => {
      if (!sessionId || event.sessionId === sessionId) {
        setEventHistory(prev => [...prev, event]);
        setLatestEvent(event);
      }
    };

    const unregister = aguiEventService.registerEventHandler('*', handleEvent);

    return () => {
      unregister();
    };
  }, [sessionId]);

  const emitEvent = React.useCallback((event) => {
    aguiEventService.emit({ ...event, sessionId });
  }, [sessionId]);

  const getHistory = React.useCallback((filters = {}) => {
    return aguiEventService.getEventHistory({ ...filters, sessionId });
  }, [sessionId]);

  return {
    eventHistory,
    latestEvent,
    emitEvent,
    getHistory,
    clearHistory: () => aguiEventService.clearHistory(sessionId),
    getStats: () => aguiEventService.getEventStats(sessionId)
  };
};