/**
 * Optimized WebSocket hook with reconnection logic and error handling
 * Implements exponential backoff and connection health monitoring
 */

import React from 'react';

const WebSocketManager = (() => {
  let instance = null;

  class WebSocketManagerClass {
    constructor() {
      if (instance) {
        return instance;
      }

      this.connections = new Map();
      this.reconnectTimers = new Map();
      this.healthCheckIntervals = new Map();
      instance = this;
    }

    // Create or get existing WebSocket connection
    getConnection(url, options = {}) {
      const connectionId = options.id || url;

      if (this.connections.has(connectionId)) {
        return this.connections.get(connectionId);
      }

      const connection = this.createConnection(url, options);
      this.connections.set(connectionId, connection);
      return connection;
    }

    // Create new WebSocket connection
    createConnection(url, options = {}) {
      const connectionId = options.id || url;

      const connection = {
        ws: null,
        url,
        options,
        state: 'disconnected',
        lastMessage: null,
        messageQueue: [],
        listeners: {
          open: [],
          message: [],
          close: [],
          error: []
        },
        reconnectAttempts: 0,
        maxReconnectAttempts: options.maxReconnectAttempts || 5,
        reconnectDelay: options.reconnectDelay || 1000,
        maxReconnectDelay: options.maxReconnectDelay || 30000,
        healthCheckInterval: options.healthCheckInterval || 30000,
        lastHealthCheck: null
      };

      this.connect(connectionId);
      this.startHealthCheck(connectionId);

      return connection;
    }

    // Connect WebSocket
    connect(connectionId) {
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      try {
        connection.ws = new WebSocket(connection.url);
        connection.state = 'connecting';

        connection.ws.onopen = () => {
          connection.state = 'connected';
          connection.reconnectAttempts = 0;
          connection.lastHealthCheck = Date.now();

          // Send queued messages
          connection.messageQueue.forEach(message => {
            connection.ws.send(JSON.stringify(message));
          });
          connection.messageQueue = [];

          this.emit(connectionId, 'open');
        };

        connection.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            connection.lastMessage = { data, timestamp: Date.now() };
            this.emit(connectionId, 'message', data);
          } catch (error) {
            console.warn('Failed to parse WebSocket message:', error);
            this.emit(connectionId, 'message', event.data);
          }
        };

        connection.ws.onclose = (event) => {
          connection.state = 'disconnected';
          this.emit(connectionId, 'close', event);

          // Attempt reconnection if not a clean close
          if (event.code !== 1000 && connection.reconnectAttempts < connection.maxReconnectAttempts) {
            this.scheduleReconnect(connectionId);
          }
        };

        connection.ws.onerror = (error) => {
          connection.state = 'error';
          this.emit(connectionId, 'error', error);
        };

      } catch (error) {
        connection.state = 'error';
        console.error('Failed to create WebSocket connection:', error);
        this.emit(connectionId, 'error', error);
      }
    }

    // Schedule reconnection with exponential backoff
    scheduleReconnect(connectionId) {
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      connection.reconnectAttempts++;
      const delay = Math.min(
        connection.reconnectDelay * Math.pow(2, connection.reconnectAttempts - 1),
        connection.maxReconnectDelay
      );

      this.emit(connectionId, 'reconnecting', {
        attempt: connection.reconnectAttempts,
        maxAttempts: connection.maxReconnectAttempts,
        delay
      });

      this.reconnectTimers.set(connectionId, setTimeout(() => {
        this.connect(connectionId);
      }, delay));
    }

    // Start health check for connection
    startHealthCheck(connectionId) {
      const connection = this.connections.get(connectionId);
      if (!connection || !connection.healthCheckInterval) return;

      this.healthCheckIntervals.set(connectionId, setInterval(() => {
        if (connection.state === 'connected' && connection.ws) {
          const now = Date.now();

          // Check if connection is stale (no messages for too long)
          if (connection.lastHealthCheck && (now - connection.lastHealthCheck > connection.healthCheckInterval)) {
            // Send ping
            try {
              connection.ws.send(JSON.stringify({ type: 'ping', timestamp: now }));
              connection.lastHealthCheck = now;
            } catch (error) {
              // If sending fails, connection is broken
              connection.ws.close(1000, 'Health check failed');
            }
          }
        }
      }, connection.healthCheckInterval));
    }

    // Stop health check
    stopHealthCheck(connectionId) {
      if (this.healthCheckIntervals.has(connectionId)) {
        clearInterval(this.healthCheckIntervals.get(connectionId));
        this.healthCheckIntervals.delete(connectionId);
      }
    }

    // Add event listener
    on(connectionId, event, callback) {
      const connection = this.connections.get(connectionId);
      if (connection && connection.listeners[event]) {
        connection.listeners[event].push(callback);
      }
    }

    // Remove event listener
    off(connectionId, event, callback) {
      const connection = this.connections.get(connectionId);
      if (connection && connection.listeners[event]) {
        const index = connection.listeners[event].indexOf(callback);
        if (index > -1) {
          connection.listeners[event].splice(index, 1);
        }
      }
    }

    // Emit event to listeners
    emit(connectionId, event, data) {
      const connection = this.connections.get(connectionId);
      if (connection && connection.listeners[event]) {
        connection.listeners[event].forEach(callback => {
          try {
            callback(data);
          } catch (error) {
            console.error('Error in WebSocket event listener:', error);
          }
        });
      }
    }

    // Send message
    send(connectionId, message) {
      const connection = this.connections.get(connectionId);
      if (!connection) return false;

      if (connection.state === 'connected' && connection.ws) {
        try {
          connection.ws.send(JSON.stringify(message));
          return true;
        } catch (error) {
          console.error('Failed to send WebSocket message:', error);
          return false;
        }
      } else {
        // Queue message for when connection is restored
        connection.messageQueue.push(message);
        return false;
      }
    }

    // Close connection
    close(connectionId) {
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      // Clear timers
      if (this.reconnectTimers.has(connectionId)) {
        clearTimeout(this.reconnectTimers.get(connectionId));
        this.reconnectTimers.delete(connectionId);
      }

      this.stopHealthCheck(connectionId);

      // Close WebSocket
      if (connection.ws) {
        connection.ws.close(1000, 'Connection closed by client');
      }

      // Remove connection
      this.connections.delete(connectionId);
    }

    // Get connection status
    getStatus(connectionId) {
      const connection = this.connections.get(connectionId);
      if (!connection) return 'not_found';

      return {
        state: connection.state,
        reconnectAttempts: connection.reconnectAttempts,
        maxReconnectAttempts: connection.maxReconnectAttempts,
        lastMessage: connection.lastMessage,
        queuedMessages: connection.messageQueue.length
      };
    }

    // Close all connections
    closeAll() {
      const connectionIds = Array.from(this.connections.keys());
      connectionIds.forEach(id => this.close(id));
    }
  }

  return WebSocketManagerClass;
})();

// React hook for WebSocket connections
export const useWebSocket = (url, options = {}) => {
  const [connection, setConnection] = React.useState(null);
  const [status, setStatus] = React.useState('disconnected');
  const [lastMessage, setLastMessage] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [reconnecting, setReconnecting] = React.useState(false);
  const [reconnectInfo, setReconnectInfo] = React.useState(null);

  const managerRef = React.useRef(null);
  const connectionIdRef = React.useRef(options.id || url);

  React.useEffect(() => {
    if (!managerRef.current) {
      managerRef.current = new WebSocketManager();
    }

    const manager = managerRef.current;
    const connectionId = connectionIdRef.current;

    // Get or create connection
    const wsConnection = manager.getConnection(url, options);
    setConnection(wsConnection);

    // Setup event listeners
    const handleOpen = () => {
      setStatus('connected');
      setError(null);
      setReconnecting(false);
      setReconnectInfo(null);
    };

    const handleMessage = (data) => {
      setLastMessage(data);
    };

    const handleClose = (event) => {
      setStatus('disconnected');
    };

    const handleError = (errorData) => {
      setError(errorData);
    };

    const handleReconnecting = (info) => {
      setReconnecting(true);
      setReconnectInfo(info);
    };

    manager.on(connectionId, 'open', handleOpen);
    manager.on(connectionId, 'message', handleMessage);
    manager.on(connectionId, 'close', handleClose);
    manager.on(connectionId, 'error', handleError);
    manager.on(connectionId, 'reconnecting', handleReconnecting);

    // Update initial status
    setStatus(wsConnection.state);

    return () => {
      manager.off(connectionId, 'open', handleOpen);
      manager.off(connectionId, 'message', handleMessage);
      manager.off(connectionId, 'close', handleClose);
      manager.off(connectionId, 'error', handleError);
      manager.off(connectionId, 'reconnecting', handleReconnecting);

      if (options.closeOnUnmount) {
        manager.close(connectionId);
      }
    };
  }, [url, options.closeOnUnmount]);

  const sendMessage = React.useCallback((message) => {
    if (managerRef.current && connectionIdRef.current) {
      return managerRef.current.send(connectionIdRef.current, message);
    }
    return false;
  }, []);

  const getConnectionStatus = React.useCallback(() => {
    if (managerRef.current && connectionIdRef.current) {
      return managerRef.current.getStatus(connectionIdRef.current);
    }
    return null;
  }, []);

  const reconnect = React.useCallback(() => {
    if (managerRef.current && connectionIdRef.current) {
      managerRef.current.close(connectionIdRef.current);
      setTimeout(() => {
        if (managerRef.current) {
          managerRef.current.getConnection(url, options);
        }
      }, 100);
    }
  }, [url, options]);

  return {
    status,
    lastMessage,
    error,
    reconnecting,
    reconnectInfo,
    sendMessage,
    getConnectionStatus,
    reconnect,
    isConnected: status === 'connected'
  };
};

// Hook for authenticated WebSocket connections
export const useAuthenticatedWebSocket = (url, getToken, options = {}) => {
  const [token, setToken] = React.useState(null);
  const wsConnection = useWebSocket(token ? `${url}?token=${token}` : null, options);

  React.useEffect(() => {
    const fetchToken = async () => {
      try {
        const authToken = await getToken();
        setToken(authToken);
      } catch (error) {
        console.error('Failed to get auth token:', error);
      }
    };

    fetchToken();

    // Refresh token periodically
    const interval = setInterval(fetchToken, 55 * 60 * 1000); // Refresh every 55 minutes

    return () => clearInterval(interval);
  }, [getToken]);

  return wsConnection;
};

export default useWebSocket;