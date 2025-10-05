import { StateGraph, END } from '@langchain/langgraph';
import { WorkflowOrchestrator } from '../../../src/backend/agents/orchestration.js';
import { MockDatabase } from '../../helpers/mock-database.js';
import { MockUIGenerator } from '../../helpers/mock-ui-generator.js';

// Mock dependencies
jest.mock('../../../src/backend/database/connection.js');
jest.mock('../../../src/backend/agents/ui-generator.js');

describe('LangGraph Workflow Orchestration', () => {
  let orchestrator: WorkflowOrchestrator;
  let mockDb: MockDatabase;
  let mockUI: MockUIGenerator;

  beforeEach(() => {
    mockDb = new MockDatabase();
    mockUI = new MockUIGenerator();
    orchestrator = new WorkflowOrchestrator(mockDb, mockUI);
  });

  describe('Workflow Initialization', () => {
    it('should create a new workflow session with proper state', async () => {
      const workflowConfig = {
        name: 'data-analysis-workflow',
        steps: ['collect-data', 'analyze-data', 'generate-insights', 'human-approval'],
        hitlPoints: ['human-approval']
      };

      const session = await orchestrator.initializeWorkflow(workflowConfig);

      expect(session).toHaveProperty('id');
      expect(session).toHaveProperty('status', 'initialized');
      expect(session).toHaveProperty('currentState', 'collect-data');
      expect(session).toHaveProperty('hitlPoints');
      expect(session.hitlPoints).toContain('human-approval');
    });

    it('should handle workflow initialization with invalid configuration', async () => {
      const invalidConfig = {
        name: '',
        steps: [],
        hitlPoints: []
      };

      await expect(orchestrator.initializeWorkflow(invalidConfig))
        .rejects.toThrow('Invalid workflow configuration');
    });
  });

  describe('State Transitions', () => {
    let sessionId: string;

    beforeEach(async () => {
      const session = await orchestrator.initializeWorkflow({
        name: 'test-workflow',
        steps: ['step1', 'step2', 'step3'],
        hitlPoints: ['step2']
      });
      sessionId = session.id;
    });

    it('should transition between states correctly', async () => {
      const result = await orchestrator.transitionState(sessionId, 'step2');

      expect(result.currentState).toBe('step2');
      expect(result.previousState).toBe('step1');
      expect(result.status).toBe('running');
    });

    it('should pause execution at HITL points', async () => {
      const result = await orchestrator.transitionState(sessionId, 'step2');

      expect(result.status).toBe('paused');
      expect(result.requiresHumanInput).toBe(true);
      expect(result.pausedAt).toBe('step2');
    });

    it('should resume execution after human approval', async () => {
      // Pause at HITL point
      await orchestrator.transitionState(sessionId, 'step2');

      // Simulate human approval
      const approval = {
        action: 'approve',
        feedback: 'Looks good, proceed to next step',
        approvedBy: 'test-user'
      };

      const result = await orchestrator.resumeWithHumanInput(sessionId, approval);

      expect(result.status).toBe('running');
      expect(result.currentState).toBe('step3');
      expect(result.lastHumanInput).toEqual(approval);
    });

    it('should handle workflow rejection and restart', async () => {
      await orchestrator.transitionState(sessionId, 'step2');

      const rejection = {
        action: 'reject',
        feedback: 'Need to revise analysis approach',
        restartFrom: 'step1'
      };

      const result = await orchestrator.resumeWithHumanInput(sessionId, rejection);

      expect(result.currentState).toBe('step1');
      expect(result.status).toBe('running');
      expect(result.rejectionCount).toBe(1);
    });
  });

  describe('UI Generation Integration', () => {
    it('should request UI generation at HITL points', async () => {
      const session = await orchestrator.initializeWorkflow({
        name: 'ui-test-workflow',
        steps: ['collect-data', 'show-dashboard', 'get-approval'],
        hitlPoints: ['show-dashboard', 'get-approval']
      });

      const uiRequest = await orchestrator.transitionState(session.id, 'show-dashboard');

      expect(mockUI.generateUI).toHaveBeenCalledWith({
        type: 'dashboard',
        data: expect.any(Object),
        interactions: ['view', 'filter', 'export']
      });

      expect(uiRequest.uiComponent).toBeDefined();
      expect(uiRequest.uiComponent.type).toBe('streamlit-dashboard');
    });

    it('should handle UI generation failures gracefully', async () => {
      mockUI.generateUI.mockRejectedValueOnce(new Error('UI generation failed'));

      const session = await orchestrator.initializeWorkflow({
        name: 'ui-failure-workflow',
        steps: ['generate-ui'],
        hitlPoints: ['generate-ui']
      });

      await expect(orchestrator.transitionState(session.id, 'generate-ui'))
        .rejects.toThrow('UI generation failed');

      // Verify workflow recovery
      const status = await orchestrator.getWorkflowStatus(session.id);
      expect(status.status).toBe('error');
      expect(status.error).toContain('UI generation failed');
    });
  });

  describe('Concurrent Workflow Management', () => {
    it('should handle multiple concurrent workflows', async () => {
      const workflows = Array(5).fill(null).map((_, i) =>
        orchestrator.initializeWorkflow({
          name: `concurrent-workflow-${i}`,
          steps: [`step-${i}-1`, `step-${i}-2`],
          hitlPoints: []
        })
      );

      const sessions = await Promise.all(workflows);

      expect(sessions).toHaveLength(5);
      sessions.forEach((session, i) => {
        expect(session.name).toBe(`concurrent-workflow-${i}`);
        expect(session.status).toBe('initialized');
      });

      // Test concurrent state transitions
      const transitions = sessions.map(session =>
        orchestrator.transitionState(session.id, `step-${session.name.split('-')[2]}-2`)
      );

      const results = await Promise.all(transitions);
      results.forEach(result => {
        expect(result.status).toBe('running');
      });
    });

    it('should prevent state conflicts in concurrent workflows', async () => {
      const session = await orchestrator.initializeWorkflow({
        name: 'conflict-test',
        steps: ['shared-resource'],
        hitlPoints: []
      });

      // Simulate concurrent access to the same workflow
      const transitions = Array(3).fill(null).map(() =>
        orchestrator.transitionState(session.id, 'shared-resource')
      );

      const results = await Promise.allSettled(transitions);

      // Only one should succeed, others should fail
      const successful = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(2);
    });
  });

  describe('Workflow Persistence and Recovery', () => {
    it('should persist workflow state to database', async () => {
      const session = await orchestrator.initializeWorkflow({
        name: 'persistence-test',
        steps: ['step1', 'step2'],
        hitlPoints: ['step2']
      });

      await orchestrator.transitionState(session.id, 'step2');

      // Verify database persistence
      const savedState = await mockDb.getWorkflowState(session.id);
      expect(savedState).toBeDefined();
      expect(savedState.currentState).toBe('step2');
      expect(savedState.status).toBe('paused');
    });

    it('should recover workflow from persisted state', async () => {
      // Simulate workflow crash and recovery
      const originalSession = await orchestrator.initializeWorkflow({
        name: 'recovery-test',
        steps: ['step1', 'step2', 'step3'],
        hitlPoints: ['step2']
      });

      await orchestrator.transitionState(originalSession.id, 'step2');

      // Create new orchestrator instance (simulating restart)
      const newOrchestrator = new WorkflowOrchestrator(mockDb, mockUI);
      const recoveredSession = await newOrchestrator.recoverWorkflow(originalSession.id);

      expect(recoveredSession.id).toBe(originalSession.id);
      expect(recoveredSession.currentState).toBe('step2');
      expect(recoveredSession.status).toBe('paused');
    });
  });

  describe('Performance Monitoring', () => {
    it('should track workflow execution time', async () => {
      const session = await orchestrator.initializeWorkflow({
        name: 'performance-test',
        steps: ['quick-step', 'slow-step'],
        hitlPoints: []
      });

      const startTime = Date.now();
      await orchestrator.transitionState(session.id, 'quick-step');
      const endTime = Date.now();

      const metrics = await orchestrator.getWorkflowMetrics(session.id);
      expect(metrics.executionTime).toBeGreaterThan(0);
      expect(metrics.executionTime).toBeLessThan(endTime - startTime + 100); // Allow margin
    });

    it('should monitor memory usage during workflow execution', async () => {
      const session = await orchestrator.initializeWorkflow({
        name: 'memory-test',
        steps: ['memory-intensive-step'],
        hitlPoints: []
      });

      const beforeMemory = process.memoryUsage().heapUsed;
      await orchestrator.transitionState(session.id, 'memory-intensive-step');
      const afterMemory = process.memoryUsage().heapUsed;

      const metrics = await orchestrator.getWorkflowMetrics(session.id);
      expect(metrics.memoryUsage).toBeDefined();
      expect(metrics.memoryUsage.peak).toBeGreaterThan(0);

      // Memory growth should be reasonable (< 100MB for this test)
      const memoryGrowth = afterMemory - beforeMemory;
      expect(memoryGrowth).toBeLessThan(100 * 1024 * 1024);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle step execution failures', async () => {
      const session = await orchestrator.initializeWorkflow({
        name: 'error-test',
        steps: ['failing-step'],
        hitlPoints: []
      });

      // Mock a failing step
      mockUI.generateUI.mockRejectedValueOnce(new Error('Step execution failed'));

      await expect(orchestrator.transitionState(session.id, 'failing-step'))
        .rejects.toThrow('Step execution failed');

      const status = await orchestrator.getWorkflowStatus(session.id);
      expect(status.status).toBe('error');
      expect(status.error).toBeDefined();
    });

    it('should implement automatic retry mechanism', async () => {
      const session = await orchestrator.initializeWorkflow({
        name: 'retry-test',
        steps: ['flaky-step'],
        hitlPoints: []
      });

      // Mock a step that fails twice then succeeds
      mockUI.generateUI
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({ success: true });

      const result = await orchestrator.transitionState(session.id, 'flaky-step', {
        retryAttempts: 3,
        retryDelay: 100
      });

      expect(result.status).toBe('running');
      expect(mockUI.generateUI).toHaveBeenCalledTimes(3);
    });

    it('should implement circuit breaker for repeated failures', async () => {
      const session = await orchestrator.initializeWorkflow({
        name: 'circuit-breaker-test',
        steps: ['unreliable-step'],
        hitlPoints: []
      });

      // Mock consistent failure
      mockUI.generateUI.mockRejectedValue(new Error('Service unavailable'));

      // Execute multiple failing attempts
      for (let i = 0; i < 5; i++) {
        try {
          await orchestrator.transitionState(session.id, 'unreliable-step');
        } catch (error) {
          // Expected to fail
        }
      }

      // Circuit breaker should be triggered
      await expect(orchestrator.transitionState(session.id, 'unreliable-step'))
        .rejects.toThrow('Circuit breaker is open');
    });
  });
});