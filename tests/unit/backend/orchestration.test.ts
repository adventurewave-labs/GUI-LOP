import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { OrchestrationService } from '../../../src/backend/services/orchestration.js';
import { mockWorkflows, mockUsers } from '../../fixtures/mock-data.js';

describe('OrchestrationService', () => {
  let orchestrationService: OrchestrationService;
  let mockLogger: any;
  let mockDatabase: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    mockDatabase = {
      saveWorkflowSession: jest.fn(),
      getWorkflowSession: jest.fn(),
      updateWorkflowSession: jest.fn(),
    };

    orchestrationService = new OrchestrationService(mockLogger, mockDatabase);
  });

  describe('Workflow Initialization', () => {
    it('should initialize a workflow with valid configuration', async () => {
      const workflowConfig = mockWorkflows.dataAnalysis;
      const user = mockUsers.validUser;

      mockDatabase.saveWorkflowSession.mockResolvedValue({
        id: 'session-123',
        workflowId: workflowConfig.id,
        userId: user.id,
        status: 'initialized',
      });

      const result = await orchestrationService.initializeWorkflow(workflowConfig, user);

      expect(result).toHaveProperty('sessionId');
      expect(result.status).toBe('initialized');
      expect(mockDatabase.saveWorkflowSession).toHaveBeenCalled();
    });

    it('should throw error for invalid workflow configuration', async () => {
      const invalidConfig = { id: '', name: '', type: '', steps: [] };
      const user = mockUsers.validUser;

      await expect(
        orchestrationService.initializeWorkflow(invalidConfig, user)
      ).rejects.toThrow('Invalid workflow configuration');
    });

    it('should handle database errors gracefully', async () => {
      const workflowConfig = mockWorkflows.dataAnalysis;
      const user = mockUsers.validUser;

      mockDatabase.saveWorkflowSession.mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(
        orchestrationService.initializeWorkflow(workflowConfig, user)
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('Workflow Execution', () => {
    it('should execute workflow steps in sequence', async () => {
      const sessionId = 'session-123';

      mockDatabase.getWorkflowSession.mockResolvedValue({
        id: sessionId,
        workflowId: 'workflow-1',
        status: 'running',
        currentStep: 0,
      });

      mockDatabase.updateWorkflowSession.mockResolvedValue({
        id: sessionId,
        status: 'completed',
        currentStep: 3,
      });

      const result = await orchestrationService.executeWorkflow(sessionId);

      expect(result.status).toBe('completed');
      expect(mockDatabase.updateWorkflowSession).toHaveBeenCalled();
    });

    it('should handle HITL interrupts correctly', async () => {
      const sessionId = 'session-123';

      mockDatabase.getWorkflowSession.mockResolvedValue({
        id: sessionId,
        workflowId: 'workflow-2',
        status: 'pending_approval',
        currentStep: 1,
      });

      const result = await orchestrationService.executeWorkflow(sessionId);

      expect(result.status).toBe('pending_approval');
      expect(result.requiresHumanInput).toBe(true);
    });

    it('should validate workflow step dependencies', async () => {
      const sessionId = 'session-123';

      mockDatabase.getWorkflowSession.mockResolvedValue({
        id: sessionId,
        workflowId: 'workflow-1',
        status: 'running',
        currentStep: 1,
      });

      const result = await orchestrationService.executeWorkflow(sessionId);

      expect(result.status).toBe('running');
      expect(result.dependenciesMet).toBe(true);
    });
  });

  describe('Workflow State Management', () => {
    it('should save workflow state correctly', async () => {
      const sessionId = 'session-123';
      const state = { step: 2, data: { processed: true } };

      mockDatabase.updateWorkflowSession.mockResolvedValue({
        id: sessionId,
        currentState: state,
      });

      const result = await orchestrationService.saveWorkflowState(sessionId, state);

      expect(result.currentState).toEqual(state);
      expect(mockDatabase.updateWorkflowSession).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ currentState: state })
      );
    });

    it('should restore workflow state from checkpoint', async () => {
      const sessionId = 'session-123';
      const checkpoint = {
        step: 2,
        data: { processed: true },
        timestamp: Date.now(),
      };

      mockDatabase.getWorkflowSession.mockResolvedValue({
        id: sessionId,
        checkpoint: checkpoint,
      });

      const result = await orchestrationService.restoreWorkflowState(sessionId);

      expect(result.checkpoint).toEqual(checkpoint);
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Restored workflow state from checkpoint for session ${sessionId}`
      );
    });

    it('should handle missing workflow session', async () => {
      const sessionId = 'non-existent-session';

      mockDatabase.getWorkflowSession.mockResolvedValue(null);

      await expect(
        orchestrationService.restoreWorkflowState(sessionId)
      ).rejects.toThrow('Workflow session not found');
    });
  });

  describe('Workflow Cleanup', () => {
    it('should cleanup completed workflows', async () => {
      const sessionId = 'session-123';

      mockDatabase.updateWorkflowSession.mockResolvedValue({
        id: sessionId,
        status: 'completed',
        cleanedAt: new Date(),
      });

      const result = await orchestrationService.cleanupWorkflow(sessionId);

      expect(result.status).toBe('completed');
      expect(result.cleanedAt).toBeDefined();
    });

    it('should handle cleanup errors', async () => {
      const sessionId = 'session-123';

      mockDatabase.updateWorkflowSession.mockRejectedValue(
        new Error('Cleanup failed')
      );

      await expect(
        orchestrationService.cleanupWorkflow(sessionId)
      ).rejects.toThrow('Cleanup failed');
    });
  });
});