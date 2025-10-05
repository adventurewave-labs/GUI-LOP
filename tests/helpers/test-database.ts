import { MockDatabase } from './mock-database.js';

export class TestDatabase extends MockDatabase {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await super.initialize();
    await this.createTables();
    await this.seedTestData();

    this.initialized = true;
  }

  private async createTables(): Promise<void> {
    // In a real implementation, this would create database tables
    console.log('Creating test database tables...');
  }

  private async seedTestData(): Promise<void> {
    // In a real implementation, this would seed test data
    console.log('Seeding test database with initial data...');
  }

  async cleanup(): Promise<void> {
    await super.cleanup();
    this.initialized = false;
  }

  // Additional test-specific methods
  async createWorkflow(workflow: any): Promise<any> {
    return await this.saveWorkflow(workflow);
  }

  async createSession(session: any): Promise<any> {
    return await this.createSession(session);
  }

  async assertWorkflowExists(id: string): Promise<boolean> {
    try {
      await this.getWorkflow(id);
      return true;
    } catch {
      return false;
    }
  }

  async assertSessionExists(id: string): Promise<boolean> {
    try {
      await this.getSession(id);
      return true;
    } catch {
      return false;
    }
  }

  async getWorkflowCount(): Promise<number> {
    const data = await this.getDataCount();
    return data.workflows;
  }

  async getSessionCount(): Promise<number> {
    const data = await this.getDataCount();
    return data.sessions;
  }

  async getEventCount(): Promise<number> {
    const data = await this.getDataCount();
    return data.events;
  }
}