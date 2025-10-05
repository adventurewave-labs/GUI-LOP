/**
 * WebSocket Service for Real-time Communication
 * Handles WebSocket connections and AG-UI protocol message routing
 */

import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

class WebSocketService {
  constructor() {
    this.connections = new Map(); // sessionId -> Set of connections
    this.connectionSessions = new Map(); // connection -> sessionId
    this.messageQueue = new Map(); // sessionId -> message queue
    this.heartbeatIntervals = new Map(); // connection -> heartbeat interval
    this.aguiService = null;

    // Configuration
    this.config = {
      heartbeatInterval: 30000, // 30 seconds
      heartbeatTimeout: 60000,  // 60 seconds
      maxQueueSize: 1000,
      reconnectDelay: 5000,     // 5 seconds
      maxReconnectAttempts: 10,
    };
  }

  async initialize(wsServer, aguiService) {
    this.wsServer = wsServer;
    this.aguiService = aguiService;

    this.wsServer.on('connection', (ws, request) => {
      this.handleConnection(ws, request);
    });

    this.wsServer.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });

    console.log('WebSocket service initialized');
  }

  handleConnection(ws, request) {
    const connectionId = uuidv4();
    const sessionId = this.extractSessionId(request);

    console.log(`WebSocket connection established: ${connectionId} for session: ${sessionId}`);

    if (!sessionId) {
      console.warn('WebSocket connection without session ID - rejecting');
      ws.close(1008, 'Session ID required');
      return;
    }

    // Store connection
    if (!this.connections.has(sessionId)) {
      this.connections.set(sessionId, new Set());
    }
    this.connections.get(sessionId).add(ws);
    this.connectionSessions.set(ws, sessionId);

    // Set up connection properties
    ws.connectionId = connectionId;
    ws.sessionId = sessionId;
    ws.isAlive = true;
    ws.reconnectAttempts = 0;

    // Set up heartbeat
    this.setupHeartbeat(ws);

    // Set up message handlers
    ws.on('message', (data) => {
      this.handleMessage(ws, data);
    });

    ws.on('close', (code, reason) => {
      this.handleDisconnection(ws, code, reason);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for connection ${connectionId}:`, error);
      this.handleDisconnection(ws, 1011, 'Internal error');
    });

    // Send welcome message
    this.sendMessage(ws, {
      type: 'connection_established',
      connection_id: connectionId,
      session_id: sessionId,
      server_timestamp: new Date().toISOString(),
      message: 'WebSocket connection established successfully',
    });

    // Send queued messages if any
    this.flushMessageQueue(sessionId);

    // Subscribe to AG-UI events for this session
    if (this.aguiService) {
      this.aguiService.subscribeToEvents(sessionId, (event) => {
        this.sendEventToSession(sessionId, event);
      });
    }
  }

  extractSessionId(request) {
    // Try to get session ID from query parameters
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const sessionId = url.searchParams.get('session_id');

    if (sessionId) {
      return sessionId;
    }

    // Try to get from headers
    return request.headers['x-session-id'];
  }

  setupHeartbeat(ws) {
    ws.isAlive = true;

    // Handle pong responses
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Set up ping interval
    const interval = setInterval(() => {
      if (!ws.isAlive) {
        console.log(`Connection ${ws.connectionId} failed heartbeat - terminating`);
        clearInterval(interval);
        ws.terminate();
        return;
      }

      ws.isAlive = false;
      ws.ping();
    }, this.config.heartbeatInterval);

    this.heartbeatIntervals.set(ws, interval);
  }

  handleMessage(ws, data) {
    try {
      const message = JSON.parse(data.toString());
      console.log(`Received message from ${ws.connectionId}:`, message.type);

      // Reset heartbeat on message
      ws.isAlive = true;

      // Handle different message types
      switch (message.type) {
        case 'ping':
          this.sendMessage(ws, {
            type: 'pong',
            timestamp: new Date().toISOString(),
          });
          break;

        case 'event_response':
          this.handleEventResponse(ws, message);
          break;

        case 'workflow_resume':
          this.handleWorkflowResume(ws, message);
          break;

        case 'subscribe':
          this.handleSubscribe(ws, message);
          break;

        case 'unsubscribe':
          this.handleUnsubscribe(ws, message);
          break;

        default:
          console.warn(`Unknown message type: ${message.type}`);
          this.sendError(ws, 'Unknown message type', message.type);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      this.sendError(ws, 'Invalid message format', 'parse_error');
    }
  }

  handleEventResponse(ws, message) {
    const { event_id, response } = message.data;

    if (!event_id || !response) {
      this.sendError(ws, 'Invalid event response format', 'invalid_response');
      return;
    }

    // Create response event
    const responseEvent = {
      id: `ws_response_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'event_response',
      session_id: ws.sessionId,
      original_event_id: event_id,
      data: response,
      timestamp: new Date().toISOString(),
      source: 'websocket',
    };

    // Process response through AG-UI service
    if (this.aguiService) {
      this.aguiService.processEventResponse(
        { id: event_id, session_id: ws.sessionId },
        responseEvent
      ).catch(error => {
        console.error('Error processing event response:', error);
        this.sendError(ws, 'Failed to process response', 'processing_error');
      });
    }

    // Send confirmation
    this.sendMessage(ws, {
      type: 'response_received',
      event_id,
      response_id: responseEvent.id,
      timestamp: new Date().toISOString(),
    });
  }

  handleWorkflowResume(ws, message) {
    const { workflow_id, human_input } = message.data;

    if (!workflow_id || !human_input) {
      this.sendError(ws, 'Invalid workflow resume format', 'invalid_resume');
      return;
    }

    // Emit workflow resume event
    this.emit('workflow_resume_request', {
      session_id: ws.sessionId,
      workflow_id,
      human_input,
      connection_id: ws.connectionId,
    });

    // Send confirmation
    this.sendMessage(ws, {
      type: 'workflow_resume_requested',
      workflow_id,
      timestamp: new Date().toISOString(),
    });
  }

  handleSubscribe(ws, message) {
    const { subscription_type, filters } = message.data;

    console.log(`Connection ${ws.connectionId} subscribed to ${subscription_type}`);

    // Store subscription
    if (!ws.subscriptions) {
      ws.subscriptions = new Set();
    }
    ws.subscriptions.add(subscription_type);

    this.sendMessage(ws, {
      type: 'subscription_confirmed',
      subscription_type,
      timestamp: new Date().toISOString(),
    });
  }

  handleUnsubscribe(ws, message) {
    const { subscription_type } = message.data;

    if (ws.subscriptions) {
      ws.subscriptions.delete(subscription_type);
    }

    this.sendMessage(ws, {
      type: 'unsubscription_confirmed',
      subscription_type,
      timestamp: new Date().toISOString(),
    });
  }

  handleDisconnection(ws, code, reason) {
    const sessionId = this.connectionSessions.get(ws);
    const connectionId = ws.connectionId;

    console.log(`WebSocket disconnected: ${connectionId} (${code}: ${reason})`);

    // Clean up heartbeat
    const interval = this.heartbeatIntervals.get(ws);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(ws);
    }

    // Remove from connections
    if (sessionId && this.connections.has(sessionId)) {
      this.connections.get(sessionId).delete(ws);
      if (this.connections.get(sessionId).size === 0) {
        this.connections.delete(sessionId);
      }
    }

    this.connectionSessions.delete(ws);

    // Emit disconnection event
    this.emit('client_disconnected', {
      session_id: sessionId,
      connection_id: connectionId,
      code,
      reason: reason.toString(),
    });
  }

  sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
      }
    }
  }

  sendError(ws, error, code = 'unknown_error') {
    this.sendMessage(ws, {
      type: 'error',
      error,
      code,
      timestamp: new Date().toISOString(),
    });
  }

  sendEventToSession(sessionId, event) {
    const connections = this.connections.get(sessionId);

    if (!connections || connections.size === 0) {
      // No active connections, queue the message
      this.queueMessage(sessionId, event);
      return;
    }

    const message = {
      type: 'agui_event',
      event,
      timestamp: new Date().toISOString(),
    };

    let sentCount = 0;
    connections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendMessage(ws, message);
        sentCount++;
      }
    });

    console.log(`Sent event to ${sentCount} connections for session ${sessionId}`);

    // If no connections received the message, queue it
    if (sentCount === 0) {
      this.queueMessage(sessionId, event);
    }
  }

  queueMessage(sessionId, message) {
    if (!this.messageQueue.has(sessionId)) {
      this.messageQueue.set(sessionId, []);
    }

    const queue = this.messageQueue.get(sessionId);

    // Limit queue size
    if (queue.length >= this.config.maxQueueSize) {
      queue.shift(); // Remove oldest message
    }

    queue.push({
      message,
      timestamp: new Date().toISOString(),
    });

    console.log(`Queued message for session ${sessionId} (queue size: ${queue.length})`);
  }

  flushMessageQueue(sessionId) {
    const queue = this.messageQueue.get(sessionId);

    if (!queue || queue.length === 0) {
      return;
    }

    console.log(`Flushing ${queue.length} queued messages for session ${sessionId}`);

    const connections = this.connections.get(sessionId);
    if (connections && connections.size > 0) {
      queue.forEach(({ message, timestamp }) => {
        connections.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            this.sendMessage(ws, {
              ...message,
              queued_at: timestamp,
              delivered_at: new Date().toISOString(),
            });
          }
        });
      });
    }

    // Clear queue
    this.messageQueue.delete(sessionId);
  }

  broadcastToAll(message, excludeSessionId = null) {
    this.connections.forEach((connections, sessionId) => {
      if (sessionId !== excludeSessionId) {
        connections.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            this.sendMessage(ws, message);
          }
        });
      }
    });
  }

  getConnectionStats() {
    const stats = {
      total_connections: 0,
      active_sessions: this.connections.size,
      queued_messages: 0,
      heartbeat_intervals: this.heartbeatIntervals.size,
    };

    this.connections.forEach((connections, sessionId) => {
      stats.total_connections += connections.size;
    });

    this.messageQueue.forEach((queue, sessionId) => {
      stats.queued_messages += queue.length;
    });

    return stats;
  }

  getSessionConnections(sessionId) {
    const connections = this.connections.get(sessionId);
    return connections ? Array.from(connections).map(ws => ({
      connection_id: ws.connectionId,
      is_alive: ws.isAlive,
      subscriptions: ws.subscriptions ? Array.from(ws.subscriptions) : [],
      reconnect_attempts: ws.reconnectAttempts,
    })) : [];
  }

  closeSessionConnections(sessionId, reason = 'Session ended') {
    const connections = this.connections.get(sessionId);

    if (connections) {
      connections.forEach(ws => {
        ws.close(1000, reason);
      });
      this.connections.delete(sessionId);
    }

    // Clear message queue
    this.messageQueue.delete(sessionId);
  }

  async shutdown() {
    console.log('Shutting down WebSocket service...');

    // Close all connections
    this.connections.forEach((connections, sessionId) => {
      this.closeSessionConnections(sessionId, 'Server shutting down');
    });

    // Clear heartbeat intervals
    this.heartbeatIntervals.forEach(interval => clearInterval(interval));
    this.heartbeatIntervals.clear();

    // Clear message queues
    this.messageQueue.clear();

    console.log('WebSocket service shutdown complete');
  }
}

// Export singleton instance
let webSocketService = null;

export const initializeWebSocketService = async (wsServer, aguiService) => {
  if (!webSocketService) {
    webSocketService = new WebSocketService();
    await webSocketService.initialize(wsServer, aguiService);
  }
  return webSocketService;
};

export const getWebSocketService = () => {
  if (!webSocketService) {
    throw new Error('WebSocket service not initialized');
  }
  return webSocketService;
};

export default WebSocketService;