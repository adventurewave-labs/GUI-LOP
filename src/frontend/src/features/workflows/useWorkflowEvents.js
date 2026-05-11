import { useEffect, useRef, useState } from 'react';
import { createWebSocketClient } from '../../services/websocket/client.js';
import { accessTokenStore } from '../../services/api/client.js';

let sharedClient = null;

/** Lazy-create a singleton WebSocket client tied to the current bearer. */
function getSharedClient() {
  if (sharedClient) return sharedClient;
  sharedClient = createWebSocketClient({
    autoConnect: false,
    getToken: () => accessTokenStore.get(),
  });
  return sharedClient;
}

/**
 * Subscribe a component to one or more event types from the v1 WebSocket.
 *
 * @param {string|string[]} eventTypes  e.g. `'workflow.completed'` or `['workflow.started', 'workflow.completed']`.
 * @param {(envelope) => void} handler  Receives the full versioned envelope.
 */
export function useWorkflowEvents(eventTypes, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    const client = getSharedClient();
    client.connect();
    const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
    const tokens = types.map((t) => client.subscribe(t, (env) => handlerRef.current?.(env)));
    const unsubStatus = client.onStatusChange(setStatus);
    setStatus(client.status);
    return () => {
      tokens.forEach((tok) => client.unsubscribe(tok));
      unsubStatus();
    };
  }, [Array.isArray(eventTypes) ? eventTypes.join(',') : eventTypes]);

  return status;
}

export function getWorkflowEventsClient() {
  return getSharedClient();
}
