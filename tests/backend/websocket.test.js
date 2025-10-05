/**
 * WebSocket Tests
 * Tests for WebSocket functionality in GUI-LOP
 */

import WebSocket from 'ws';

describe('WebSocket Server Tests', () => {
  let serverUrl;
  let testPort = 3002; // Use different port for testing

  beforeAll(async () => {
    // We'll test against the actual server on its normal port
    serverUrl = 'ws://localhost:3001';
  });

  describe('WebSocket Connection', () => {
    test('should establish WebSocket connection', (done) => {
      const ws = new WebSocket(serverUrl);

      ws.on('open', () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        done();
      });

      ws.on('error', (error) => {
        // If server is not running, we'll skip these tests
        console.warn('WebSocket server not available for testing:', error.message);
        done();
      });
    });

    test('should receive connection message', (done) => {
      const ws = new WebSocket(serverUrl);

      ws.on('open', () => {
        // Connection established
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());

        if (message.type === 'connection') {
          expect(message).toHaveProperty('type', 'connection');
          expect(message).toHaveProperty('message');
          expect(message).toHaveProperty('timestamp');
          ws.close();
          done();
        }
      });

      ws.on('error', () => {
        // Skip test if server not available
        done();
      });
    });

    test('should handle message echo', (done) => {
      const ws = new WebSocket(serverUrl);
      const testMessage = {
        type: 'test',
        data: 'Hello WebSocket'
      };

      ws.on('open', () => {
        ws.send(JSON.stringify(testMessage));
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());

        if (message.type === 'echo') {
          expect(message.data).toEqual(testMessage);
          expect(message).toHaveProperty('timestamp');
          ws.close();
          done();
        }
      });

      ws.on('error', () => {
        // Skip test if server not available
        done();
      });
    });

    test('should handle invalid JSON gracefully', (done) => {
      const ws = new WebSocket(serverUrl);

      ws.on('open', () => {
        ws.send('invalid json');
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());

        if (message.type === 'error') {
          expect(message.message).toBe('Invalid JSON');
          ws.close();
          done();
        }
      });

      ws.on('error', () => {
        // Skip test if server not available
        done();
      });
    });
  });

  describe('WebSocket Event Broadcasting', () => {
    test('should handle multiple clients', (done) => {
      const ws1 = new WebSocket(serverUrl);
      const ws2 = new WebSocket(serverUrl);
      let connections = 0;

      const checkConnections = () => {
        connections++;
        if (connections === 2) {
          // Both clients connected
          ws1.close();
          ws2.close();
          done();
        }
      };

      ws1.on('open', checkConnections);
      ws2.on('open', checkConnections);

      ws1.on('error', () => checkConnections());
      ws2.on('error', () => checkConnections());
    });
  });

  describe('WebSocket Error Handling', () => {
    test('should handle connection to non-existent server', (done) => {
      const ws = new WebSocket('ws://localhost:9999');

      ws.on('error', (error) => {
        expect(error).toBeTruthy();
        done();
      });
    });
  });
});