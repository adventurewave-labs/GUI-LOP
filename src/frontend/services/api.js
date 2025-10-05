/**
 * API Service - Backend communication layer
 * Handles HTTP requests and WebSocket connections to the GUI-LOP backend
 */

class APIService {
  constructor() {
    this.baseUrl = this.getBaseUrl();
    this.wsUrl = this.getWebSocketUrl();
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'X-Client-Type': 'gui-lop-frontend'
    };
  }

  /**
   * Get base API URL from environment or default
   */
  getBaseUrl() {
    if (typeof window !== 'undefined') {
      return process.env.REACT_APP_API_URL ||
             process.env.NEXT_PUBLIC_API_URL ||
             window.location.origin + '/api';
    }
    return process.env.API_URL || 'http://localhost:3001/api';
  }

  /**
   * Get WebSocket URL
   */
  getWebSocketUrl(sessionId) {
    const wsProtocol = this.baseUrl.startsWith('https') ? 'wss' : 'ws';
    const wsHost = this.baseUrl.replace(/^https?:/, '');
    return `${wsProtocol}${wsHost}/ws/${sessionId}`;
  }

  /**
   * Make HTTP request with error handling
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const config = {
      headers: { ...this.defaultHeaders, ...options.headers },
      ...options
    };

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API request failed: ${endpoint}`, error);
      throw error;
    }
  }

  /**
   * GET request
   */
  async get(endpoint, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const url = queryString ? `${endpoint}?${queryString}` : endpoint;
    return this.request(url, { method: 'GET' });
  }

  /**
   * POST request
   */
  async post(endpoint, data = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  /**
   * PUT request
   */
  async put(endpoint, data = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  /**
   * DELETE request
   */
  async delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }

  /**
   * Initialize a new workflow session
   */
  async initializeSession(workflowConfig = {}) {
    return this.post('/sessions', {
      type: 'gui-lop',
      config: workflowConfig,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get session information
   */
  async getSession(sessionId) {
    return this.get(`/sessions/${sessionId}`);
  }

  /**
   * Update session configuration
   */
  async updateSession(sessionId, updates) {
    return this.put(`/sessions/${sessionId}`, updates);
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId) {
    return this.delete(`/sessions/${sessionId}`);
  }

  /**
   * Get list of active sessions
   */
  async getSessions(filters = {}) {
    return this.get('/sessions', filters);
  }

  /**
   * Start a workflow
   */
  async startWorkflow(sessionId, workflowConfig) {
    return this.post(`/sessions/${sessionId}/workflows`, {
      ...workflowConfig,
      startTime: new Date().toISOString()
    });
  }

  /**
   * Pause a workflow
   */
  async pauseWorkflow(sessionId, reason = '') {
    return this.post(`/sessions/${sessionId}/pause`, { reason });
  }

  /**
   * Resume a workflow
   */
  async resumeWorkflow(sessionId) {
    return this.post(`/sessions/${sessionId}/resume`);
  }

  /**
   * Cancel a workflow
   */
  async cancelWorkflow(sessionId, reason = '') {
    return this.post(`/sessions/${sessionId}/cancel`, { reason });
  }

  /**
   * Get workflow status
   */
  async getWorkflowStatus(sessionId) {
    return this.get(`/sessions/${sessionId}/status`);
  }

  /**
   * Send tool input response
   */
  async sendToolInputResponse(sessionId, toolId, input) {
    return this.post(`/sessions/${sessionId}/tool-input`, {
      toolId,
      input,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Send approval response
   */
  async sendApprovalResponse(sessionId, approved, additionalData = {}) {
    return this.post(`/sessions/${sessionId}/approval`, {
      approved,
      ...additionalData,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get UI configuration for a session
   */
  async getUIConfig(sessionId, uiType = 'streamlit') {
    return this.get(`/sessions/${sessionId}/ui-config`, { uiType });
  }

  /**
   * Generate a new UI component
   */
  async generateUI(sessionId, uiRequest) {
    return this.post(`/sessions/${sessionId}/generate-ui`, {
      ...uiRequest,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Update existing UI component
   */
  async updateUI(sessionId, uiId, updates) {
    return this.put(`/sessions/${sessionId}/ui/${uiId}`, {
      ...updates,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get available UI templates
   */
  async getUITemplates(category = null) {
    const params = category ? { category } : {};
    return this.get('/ui-templates', params);
  }

  /**
   * Upload data for UI visualization
   */
  async uploadData(sessionId, data, metadata = {}) {
    return this.post(`/sessions/${sessionId}/data`, {
      data,
      metadata,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get session data
   */
  async getSessionData(sessionId, dataType = null) {
    const params = dataType ? { type: dataType } : {};
    return this.get(`/sessions/${sessionId}/data`, params);
  }

  /**
   * Send custom AG-UI event
   */
  async sendAGUIEvent(sessionId, eventType, payload = {}) {
    return this.post(`/sessions/${sessionId}/events`, {
      type: eventType,
      payload: {
        ...payload,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Get event history for session
   */
  async getEventHistory(sessionId, filters = {}) {
    return this.get(`/sessions/${sessionId}/events`, filters);
  }

  /**
   * Health check for API
   */
  async healthCheck() {
    return this.get('/health');
  }

  /**
   * Get API version info
   */
  async getVersion() {
    return this.get('/version');
  }

  /**
   * Test WebSocket connection
   */
  async testWebSocket(sessionId) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.getWebSocketUrl(sessionId));

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }, 5000);

      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
    });
  }

  /**
   * Stream events from server
   */
  async streamEvents(sessionId, onEvent, onError) {
    const ws = new WebSocket(this.getWebSocketUrl(sessionId));

    ws.onopen = () => {
      console.log(`WebSocket stream opened for session: ${sessionId}`);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onEvent(data);
      } catch (error) {
        console.error('Failed to parse streamed event:', error);
        onError?.(error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket stream error:', error);
      onError?.(error);
    };

    ws.onclose = () => {
      console.log('WebSocket stream closed');
    };

    // Return cleanup function
    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }

  /**
   * Batch multiple requests
   */
  async batch(requests) {
    return this.post('/batch', { requests });
  }

  /**
   * Cache management
   */
  async clearCache(sessionId = null) {
    const endpoint = sessionId ? `/sessions/${sessionId}/cache` : '/cache';
    return this.delete(endpoint);
  }
}

// Singleton instance
export const apiService = new APIService();

/**
 * React hook for API operations
 */
export const useAPI = (sessionId) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const execute = useCallback(async (operation, ...args) => {
    setLoading(true);
    setError(null);

    try {
      const result = await apiService[operation](sessionId, ...args);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  return {
    loading,
    error,
    execute,
    // Common operations
    getSession: () => execute('getSession'),
    startWorkflow: (config) => execute('startWorkflow', config),
    pauseWorkflow: (reason) => execute('pauseWorkflow', reason),
    resumeWorkflow: () => execute('resumeWorkflow'),
    cancelWorkflow: (reason) => execute('cancelWorkflow', reason),
    sendApprovalResponse: (approved, data) => execute('sendApprovalResponse', approved, data),
    sendToolInputResponse: (toolId, input) => execute('sendToolInputResponse', toolId, input),
    uploadData: (data, metadata) => execute('uploadData', data, metadata),
    generateUI: (request) => execute('generateUI', request)
  };
};

export default apiService;