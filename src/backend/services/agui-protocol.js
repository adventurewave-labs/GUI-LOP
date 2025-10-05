/**
 * AG-UI Protocol Service
 * Implements the Agent-UI Communication Protocol for dynamic UI generation
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

export class AGUIProtocolService extends EventEmitter {
  constructor(dbService) {
    super();
    this.dbService = dbService;
    this.sessions = new Map();
    this.subscriptions = new Map();

    // Protocol version
    this.protocolVersion = '1.0.0';

    // Event types
    this.eventTypes = {
      TOOL_INPUT_REQUEST: 'tool_input_request',
      UI_UPDATE: 'ui_update',
      APPROVAL_REQUEST: 'approval_request',
      DATA_DISPLAY: 'data_display',
      WORKFLOW_STATUS: 'workflow_status',
      EVENT_RESPONSE: 'event_response',
    };

    // UI component types
    this.componentTypes = {
      TEXT_INPUT: 'text_input',
      SELECT: 'select',
      CHECKBOX: 'checkbox',
      RADIO: 'radio',
      SLIDER: 'slider',
      BUTTON: 'button',
      TABLE: 'table',
      CHART: 'chart',
      FORM: 'form',
      DASHBOARD: 'dashboard',
    };
  }

  async initialize() {
    console.log('AG-UI Protocol Service initialized');
    console.log(`Protocol version: ${this.protocolVersion}`);
    console.log(`Supported event types: ${Object.values(this.eventTypes).join(', ')}`);
  }

  /**
   * Send an AG-UI protocol event
   */
  async sendEvent(sessionId, event) {
    try {
      // Validate event
      const validatedEvent = this.validateEvent(event);

      // Add metadata
      const fullEvent = {
        ...validatedEvent,
        protocol_version: this.protocolVersion,
        server_timestamp: new Date().toISOString(),
        event_id: validatedEvent.event_id || uuidv4(),
      };

      // Store in database
      await this.dbService.createEvent(fullEvent);

      // Emit to subscribers
      this.emitToSession(sessionId, fullEvent);

      // Handle special event types
      await this.handleSpecialEvent(fullEvent);

      console.log(`Event sent to session ${sessionId}: ${fullEvent.type}`);
      return fullEvent;

    } catch (error) {
      console.error('Error sending AG-UI event:', error);
      throw error;
    }
  }

  /**
   * Process an event response from human
   */
  async processEventResponse(originalEvent, responseEvent) {
    try {
      console.log(`Processing response for event ${originalEvent.id}`);

      switch (originalEvent.type) {
        case this.eventTypes.TOOL_INPUT_REQUEST:
          await this.handleToolInputResponse(originalEvent, responseEvent);
          break;
        case this.eventTypes.APPROVAL_REQUEST:
          await this.handleApprovalResponse(originalEvent, responseEvent);
          break;
        case this.eventTypes.UI_UPDATE:
          await this.handleUIUpdateResponse(originalEvent, responseEvent);
          break;
        default:
          console.log(`No special handling for event type: ${originalEvent.type}`);
      }

      // Send confirmation
      await this.sendEvent(originalEvent.session_id, {
        type: this.eventTypes.EVENT_RESPONSE,
        data: {
          original_event_id: originalEvent.id,
          response_event_id: responseEvent.id,
          processed: true,
          timestamp: new Date().toISOString(),
        },
      });

    } catch (error) {
      console.error('Error processing event response:', error);
      throw error;
    }
  }

  /**
   * Subscribe to events for a session
   */
  subscribeToEvents(sessionId, callback) {
    const subscriptionId = uuidv4();

    if (!this.subscriptions.has(sessionId)) {
      this.subscriptions.set(sessionId, new Map());
    }

    this.subscriptions.get(sessionId).set(subscriptionId, callback);

    return {
      sessionId,
      subscriptionId,
      unsubscribe: () => {
        const sessionSubs = this.subscriptions.get(sessionId);
        if (sessionSubs) {
          sessionSubs.delete(subscriptionId);
          if (sessionSubs.size === 0) {
            this.subscriptions.delete(sessionId);
          }
        }
      },
    };
  }

  /**
   * Emit event to all subscribers of a session
   */
  emitToSession(sessionId, event) {
    const sessionSubs = this.subscriptions.get(sessionId);
    if (sessionSubs) {
      sessionSubs.forEach(callback => {
        try {
          callback(event);
        } catch (error) {
          console.error('Error in event callback:', error);
        }
      });
    }
  }

  /**
   * Validate AG-UI protocol event
   */
  validateEvent(event) {
    const required = ['type', 'session_id', 'data'];
    const missing = required.filter(field => !event[field]);

    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    // Validate event type
    if (!Object.values(this.eventTypes).includes(event.type)) {
      throw new Error(`Invalid event type: ${event.type}`);
    }

    // Validate session ID format
    if (!this.isValidUUID(event.session_id)) {
      throw new Error('Invalid session ID format');
    }

    // Validate data structure based on event type
    this.validateEventData(event.type, event.data);

    return event;
  }

  /**
   * Validate event data structure
   */
  validateEventData(type, data) {
    switch (type) {
      case this.eventTypes.TOOL_INPUT_REQUEST:
        if (!data.tool_name || !data.parameters) {
          throw new Error('Tool input request must have tool_name and parameters');
        }
        break;
      case this.eventTypes.UI_UPDATE:
        if (!data.components || !Array.isArray(data.components)) {
          throw new Error('UI update must have components array');
        }
        data.components.forEach(component => {
          if (!component.type || !component.id) {
            throw new Error('Each UI component must have type and id');
          }
        });
        break;
      case this.eventTypes.APPROVAL_REQUEST:
        if (!data.message || !data.options) {
          throw new Error('Approval request must have message and options');
        }
        break;
      case this.eventTypes.DATA_DISPLAY:
        if (!data.data || !data.display_type) {
          throw new Error('Data display must have data and display_type');
        }
        break;
      case this.eventTypes.WORKFLOW_STATUS:
        if (!data.workflow_id || !data.status) {
          throw new Error('Workflow status must have workflow_id and status');
        }
        break;
    }
  }

  /**
   * Handle special event types
   */
  async handleSpecialEvent(event) {
    switch (event.type) {
      case this.eventTypes.WORKFLOW_STATUS:
        await this.handleWorkflowStatusEvent(event);
        break;
      case this.eventTypes.DATA_DISPLAY:
        await this.handleDataDisplayEvent(event);
        break;
    }
  }

  /**
   * Handle tool input response
   */
  async handleToolInputResponse(originalEvent, responseEvent) {
    const { tool_name, parameters } = originalEvent.data;
    const { response } = responseEvent.data;

    console.log(`Tool input received for ${tool_name}:`, response);

    // Here you would typically:
    // 1. Validate the input
    // 2. Execute the tool
    // 3. Send results back

    await this.sendEvent(originalEvent.session_id, {
      type: this.eventTypes.DATA_DISPLAY,
      data: {
        display_type: 'tool_result',
        tool_name,
        result: response,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Handle approval response
   */
  async handleApprovalResponse(originalEvent, responseEvent) {
    const { response } = responseEvent.data;
    const approved = response.approved;
    const notes = response.notes || '';

    console.log(`Approval received: ${approved ? 'APPROVED' : 'REJECTED'}`);
    if (notes) {
      console.log(`Notes: ${notes}`);
    }

    // Send workflow status update
    await this.sendEvent(originalEvent.session_id, {
      type: this.eventTypes.WORKFLOW_STATUS,
      data: {
        workflow_id: originalEvent.workflow_id,
        status: approved ? 'approved' : 'rejected',
        approval_details: {
          approved,
          notes,
          timestamp: new Date().toISOString(),
        },
      },
    });
  }

  /**
   * Handle UI update response
   */
  async handleUIUpdateResponse(originalEvent, responseEvent) {
    const { response } = responseEvent.data;

    console.log('UI interaction received:', response);

    // Process the UI interaction and potentially trigger workflow continuation
    if (originalEvent.workflow_id && response.continue_workflow) {
      await this.sendEvent(originalEvent.session_id, {
        type: this.eventTypes.WORKFLOW_STATUS,
        data: {
          workflow_id: originalEvent.workflow_id,
          status: 'resuming',
          user_input: response,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  /**
   * Handle workflow status event
   */
  async handleWorkflowStatusEvent(event) {
    const { workflow_id, status } = event.data;

    console.log(`Workflow ${workflow_id} status: ${status}`);

    // Update workflow status in database
    await this.dbService.updateWorkflowStatus(workflow_id, status);

    // Emit workflow status change event
    this.emit('workflow_status_changed', {
      workflow_id,
      status,
      event,
    });
  }

  /**
   * Handle data display event
   */
  async handleDataDisplayEvent(event) {
    const { display_type, data } = event.data;

    console.log(`Data display event: ${display_type}`);

    // Log data display for analytics
    await this.dbService.createDataDisplayLog({
      session_id: event.session_id,
      workflow_id: event.workflow_id,
      display_type,
      data_size: JSON.stringify(data).length,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Create a tool input request event
   */
  createToolInputRequest(sessionId, workflowId, toolName, parameters, options = {}) {
    return {
      type: this.eventTypes.TOOL_INPUT_REQUEST,
      session_id: sessionId,
      workflow_id: workflowId,
      data: {
        tool_name: toolName,
        parameters,
        required: options.required || true,
        validation: options.validation || {},
        placeholder: options.placeholder || '',
        description: options.description || '',
      },
      priority: options.priority || 'medium',
    };
  }

  /**
   * Create a UI update event
   */
  createUIUpdateEvent(sessionId, workflowId, components, options = {}) {
    return {
      type: this.eventTypes.UI_UPDATE,
      session_id: sessionId,
      workflow_id: workflowId,
      data: {
        components,
        layout: options.layout || 'vertical',
        theme: options.theme || 'default',
        title: options.title || '',
        description: options.description || '',
      },
      priority: options.priority || 'medium',
    };
  }

  /**
   * Create an approval request event
   */
  createApprovalRequestEvent(sessionId, workflowId, message, options = {}) {
    return {
      type: this.eventTypes.APPROVAL_REQUEST,
      session_id: sessionId,
      workflow_id: workflowId,
      data: {
        message,
        options: options.options || ['approve', 'reject'],
        default_option: options.default_option || null,
        allow_notes: options.allow_notes !== false,
        timeout: options.timeout || null,
      },
      priority: options.priority || 'high',
    };
  }

  /**
   * Create a data display event
   */
  createDataDisplayEvent(sessionId, workflowId, displayData, displayType, options = {}) {
    return {
      type: this.eventTypes.DATA_DISPLAY,
      session_id: sessionId,
      workflow_id: workflowId,
      data: {
        data: displayData,
        display_type: displayType,
        title: options.title || '',
        description: options.description || '',
        interactive: options.interactive || false,
        export_options: options.export_options || [],
      },
      priority: options.priority || 'medium',
    };
  }

  /**
   * Create a workflow status event
   */
  createWorkflowStatusEvent(sessionId, workflowId, status, details = {}) {
    return {
      type: this.eventTypes.WORKFLOW_STATUS,
      session_id: sessionId,
      workflow_id: workflowId,
      data: {
        workflow_id,
        status,
        ...details,
        timestamp: new Date().toISOString(),
      },
      priority: 'low',
    };
  }

  /**
   * Get session statistics
   */
  async getSessionStats(sessionId) {
    try {
      const stats = await this.dbService.getSessionStats(sessionId);
      return {
        session_id: sessionId,
        total_events: stats.total_events,
        events_by_type: stats.events_by_type,
        active_workflows: stats.active_workflows,
        last_activity: stats.last_activity,
        protocol_version: this.protocolVersion,
      };
    } catch (error) {
      console.error('Error getting session stats:', error);
      throw error;
    }
  }

  /**
   * Utility function to validate UUID format
   */
  isValidUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Get protocol information
   */
  getProtocolInfo() {
    return {
      version: this.protocolVersion,
      event_types: Object.values(this.eventTypes),
      component_types: Object.values(this.componentTypes),
      active_sessions: this.subscriptions.size,
      total_subscriptions: Array.from(this.subscriptions.values())
        .reduce((total, sessionSubs) => total + sessionSubs.size, 0),
    };
  }
}