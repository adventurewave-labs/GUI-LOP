export class MockDatabase {
  private workflows: Map<string, any> = new Map();
  private sessions: Map<string, any> = new Map();
  private events: Map<string, any> = new Map();
  private connected = true;

  async initialize(): Promise<void> {
    // Initialize mock database
    this.workflows.clear();
    this.sessions.clear();
    this.events.clear();
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async reconnect(): Promise<void> {
    this.connected = true;
  }

  async saveWorkflow(workflow: any): Promise<any> {
    if (!this.connected) {
      throw new Error('Database unavailable');
    }

    const savedWorkflow = {
      ...workflow,
      id: workflow.id || `workflow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.workflows.set(savedWorkflow.id, savedWorkflow);
    return savedWorkflow;
  }

  async getWorkflow(id: string): Promise<any> {
    if (!this.connected) {
      throw new Error('Database unavailable');
    }

    const workflow = this.workflows.get(id);
    if (!workflow) {
      throw new Error(`Workflow not found: ${id}`);
    }

    return workflow;
  }

  async updateWorkflow(id: string, updates: any): Promise<any> {
    if (!this.connected) {
      throw new Error('Database unavailable');
    }

    const workflow = await this.getWorkflow(id);
    const updatedWorkflow = {
      ...workflow,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    this.workflows.set(id, updatedWorkflow);
    return updatedWorkflow;
  }

  async getWorkflowState(id: string): Promise<any> {
    if (!this.connected) {
      throw new Error('Database unavailable');
    }

    const workflow = this.workflows.get(id);
    return workflow?.state || null;
  }

  async saveWorkflowState(id: string, state: any): Promise<void> {
    if (!this.connected) {
      throw new Error('Database unavailable');
    }

    const workflow = await this.getWorkflow(id);
    workflow.state = state;
    workflow.updatedAt = new Date().toISOString();
    this.workflows.set(id, workflow);
  }

  async createSession(session: any): Promise<any> {
    if (!this.connected) {
      throw new Error('Database unavailable');
    }

    const newSession = {
      ...session,
      id: session.id || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString()
    };

    this.sessions.set(newSession.id, newSession);
    return newSession;
  }

  async getSession(id: string): Promise<any> {
    if (!this.connected) {
      throw new Error('Database unavailable');
    }

    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    // Update last accessed time
    session.lastAccessed = new Date().toISOString();
    this.sessions.set(id, session);

    return session;
  }

  async updateSession(id: string, updates: any): Promise<any> {
    if (!this.connected) {
      throw new Error('Database unavailable');
    }

    const session = await this.getSession(id);
    const updatedSession = {
      ...session,
      ...updates,
      lastAccessed: new Date().toISOString()
    };

    this.sessions.set(id, updatedSession);
    return updatedSession;
  }

  async deleteSession(id: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Database unavailable');
    }

    this.sessions.delete(id);
  }

  async getActiveSessions(): Promise<string[]> {
    if (!this.connected) {
      throw new Error('Database unavailable');
    }

    const now = new Date().getTime();
    const activeSessions: string[] = [];

    this.sessions.forEach((session, id) => {
      const lastAccessed = new Date(session.lastAccessed).getTime();
      const ttl = session.ttl || 3600000; // Default 1 hour
      if (now - lastAccessed < ttl) {
        activeSessions.push(id);
      }
    });

    return activeSessions;
  }

  async logEvent(event: any): Promise<any> {
    if (!this.connected) {
      throw new Error('Database unavailable');
    }

    const loggedEvent = {
      ...event,
      id: event.id || `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: event.timestamp || new Date().toISOString()
    };

    this.events.set(loggedEvent.id, loggedEvent);
    return loggedEvent;
  }

  async getEvents(workflowId?: string, limit: number = 100): Promise<any[]> {
    if (!this.connected) {
      throw new Error('Database unavailable');
    }

    let events = Array.from(this.events.values());

    if (workflowId) {
      events = events.filter(event => event.workflowId === workflowId);
    }

    return events
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  async clear(): Promise<void> {
    this.workflows.clear();
    this.sessions.clear();
    this.events.clear();
  }

  async cleanup(): Promise<void> {
    await this.clear();
    this.connected = false;
  }

  // Additional helper methods for testing
  async simulateFailure(): Promise<void> {
    this.connected = false;
  }

  async simulateRecovery(): Promise<void> {
    this.connected = true;
  }

  async getDataCount(): Promise<{ workflows: number; sessions: number; events: number }> {
    return {
      workflows: this.workflows.size,
      sessions: this.sessions.size,
      events: this.events.size
    };
  }
}