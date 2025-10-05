/**
 * Workflow Management API Routes
 * Handles workflow creation, execution, and management
 */

import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { WorkflowOrchestrator } from '../agents/orchestration.js';
import { DatabaseService } from '../services/database.js';

const router = express.Router();

// Initialize services (in production, these would be injected)
const dbService = new DatabaseService();
const orchestrator = new WorkflowOrchestrator(dbService, null);

// Middleware to validate requests
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array(),
    });
  }
  next();
};

/**
 * GET /api/workflows/templates
 * Get available workflow templates
 */
router.get('/templates', async (req, res) => {
  try {
    const templates = await orchestrator.getAvailableTemplates();

    res.json({
      success: true,
      templates,
      count: templates.length,
    });

  } catch (error) {
    console.error('Error getting workflow templates:', error);
    res.status(500).json({
      error: 'Failed to get workflow templates',
      details: error.message,
    });
  }
});

/**
 * GET /api/workflows/templates/:template_id
 * Get specific workflow template details
 */
router.get('/templates/:template_id', [
  param('template_id').isLength({ min: 1 }).withMessage('Template ID required'),
], validateRequest, async (req, res) => {
  try {
    const { template_id } = req.params;
    const templates = await orchestrator.getAvailableTemplates();

    const template = templates.find(t => t.id === template_id);
    if (!template) {
      return res.status(404).json({
        error: 'Template not found',
        template_id,
      });
    }

    res.json({
      success: true,
      template,
    });

  } catch (error) {
    console.error('Error getting workflow template:', error);
    res.status(500).json({
      error: 'Failed to get workflow template',
      details: error.message,
    });
  }
});

/**
 * POST /api/workflows
 * Create a new workflow instance
 */
router.post('/', [
  body('template_id').isLength({ min: 1 }).withMessage('Template ID required'),
  body('session_id').isUUID().withMessage('Valid session ID required'),
  body('input_data').isObject().withMessage('Input data must be an object'),
  body('input_data.*').notEmpty().withMessage('Input data fields cannot be empty'),
], validateRequest, async (req, res) => {
  try {
    const { template_id, session_id, input_data } = req.body;

    // Create workflow
    const workflowId = await orchestrator.createWorkflow(template_id, input_data, session_id);

    // Get initial status
    const workflowStatus = await orchestrator.getWorkflowStatus(workflowId);

    res.status(201).json({
      success: true,
      workflow_id: workflowId,
      template_id,
      session_id,
      status: workflowStatus.status,
      created_at: workflowStatus.created_at,
      message: 'Workflow created successfully',
    });

  } catch (error) {
    console.error('Error creating workflow:', error);
    res.status(500).json({
      error: 'Failed to create workflow',
      details: error.message,
    });
  }
});

/**
 * POST /api/workflows/:workflow_id/execute
 * Execute a workflow
 */
router.post('/:workflow_id/execute', [
  param('workflow_id').isUUID().withMessage('Valid workflow ID required'),
  body('execution_options').optional().isObject().withMessage('Execution options must be an object'),
], validateRequest, async (req, res) => {
  try {
    const { workflow_id } = req.params;
    const { execution_options = {} } = req.body;

    // Check if workflow exists
    const existingWorkflow = await orchestrator.getWorkflowStatus(workflow_id);
    if (!existingWorkflow) {
      return res.status(404).json({
        error: 'Workflow not found',
        workflow_id,
      });
    }

    // Execute workflow
    try {
      const result = await orchestrator.executeWorkflow(workflow_id, execution_options);

      res.json({
        success: true,
        workflow_id,
        status: 'completed',
        result,
        completed_at: result.completed_at,
        message: 'Workflow executed successfully',
      });

    } catch (executionError) {
      if (executionError.message.includes('paused')) {
        // Workflow paused for human interaction
        const pausedStatus = await orchestrator.getWorkflowStatus(workflow_id);

        res.json({
          success: true,
          workflow_id,
          status: 'paused',
          message: 'Workflow paused for human interaction',
          current_node: pausedStatus.state?.current_node,
          required_input: pausedStatus.state?.required_input,
          ui_components: pausedStatus.state?.ui_components || [],
        });

      } else {
        throw executionError;
      }
    }

  } catch (error) {
    console.error('Error executing workflow:', error);
    res.status(500).json({
      error: 'Failed to execute workflow',
      details: error.message,
    });
  }
});

/**
 * POST /api/workflows/:workflow_id/resume
 * Resume a paused workflow with human input
 */
router.post('/:workflow_id/resume', [
  param('workflow_id').isUUID().withMessage('Valid workflow ID required'),
  body('human_input').isObject().withMessage('Human input must be an object'),
  body('human_input.response').notEmpty().withMessage('Response is required'),
], validateRequest, async (req, res) => {
  try {
    const { workflow_id } = req.params;
    const { human_input } = req.body;

    // Check if workflow exists and is paused
    const existingWorkflow = await orchestrator.getWorkflowStatus(workflow_id);
    if (!existingWorkflow) {
      return res.status(404).json({
        error: 'Workflow not found',
        workflow_id,
      });
    }

    if (existingWorkflow.status !== 'paused') {
      return res.status(400).json({
        error: 'Workflow is not paused',
        workflow_id,
        current_status: existingWorkflow.status,
      });
    }

    // Resume workflow with human input
    const result = await orchestrator.resumeWorkflow(workflow_id, human_input);

    res.json({
      success: true,
      workflow_id,
      status: 'completed',
      result,
      completed_at: result.completed_at,
      message: 'Workflow resumed and completed successfully',
    });

  } catch (error) {
    console.error('Error resuming workflow:', error);
    res.status(500).json({
      error: 'Failed to resume workflow',
      details: error.message,
    });
  }
});

/**
 * GET /api/workflows/:workflow_id
 * Get workflow status and details
 */
router.get('/:workflow_id', [
  param('workflow_id').isUUID().withMessage('Valid workflow ID required'),
], validateRequest, async (req, res) => {
  try {
    const { workflow_id } = req.params;

    const workflow = await orchestrator.getWorkflowStatus(workflow_id);

    res.json({
      success: true,
      workflow,
    });

  } catch (error) {
    console.error('Error getting workflow:', error);
    res.status(500).json({
      error: 'Failed to get workflow',
      details: error.message,
    });
  }
});

/**
 * GET /api/workflows
 * List workflows with filtering
 */
router.get('/', [
  query('session_id').optional().isUUID().withMessage('Valid session ID required'),
  query('template_id').optional().isLength({ min: 1 }).withMessage('Template ID required'),
  query('status').optional().isIn(['created', 'running', 'paused', 'completed', 'failed']).withMessage('Invalid status'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
], validateRequest, async (req, res) => {
  try {
    const { session_id, template_id, status, limit = 50, offset = 0 } = req.query;

    const workflows = await dbService.getWorkflows({
      session_id,
      template_id,
      status,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.json({
      success: true,
      workflows,
      count: workflows.length,
      filters: { session_id, template_id, status },
      pagination: { limit: parseInt(limit), offset: parseInt(offset) },
    });

  } catch (error) {
    console.error('Error listing workflows:', error);
    res.status(500).json({
      error: 'Failed to list workflows',
      details: error.message,
    });
  }
});

/**
 * PUT /api/workflows/:workflow_id/state
 * Update workflow state (for debugging/admin)
 */
router.put('/:workflow_id/state', [
  param('workflow_id').isUUID().withMessage('Valid workflow ID required'),
  body('state').isObject().withMessage('State must be an object'),
  body('reason').optional().isString().withMessage('Reason must be a string'),
], validateRequest, async (req, res) => {
  try {
    const { workflow_id } = req.params;
    const { state, reason } = req.body;

    // Check if workflow exists
    const existingWorkflow = await orchestrator.getWorkflowStatus(workflow_id);
    if (!existingWorkflow) {
      return res.status(404).json({
        error: 'Workflow not found',
        workflow_id,
      });
    }

    // Update workflow state
    await dbService.updateWorkflow(workflow_id, {
      state: {
        ...existingWorkflow.state,
        ...state,
        updated_at: new Date().toISOString(),
      },
      updated_by: 'api',
      update_reason: reason || 'Manual state update via API',
    });

    // Get updated workflow
    const updatedWorkflow = await orchestrator.getWorkflowStatus(workflow_id);

    res.json({
      success: true,
      workflow_id,
      updated_at: updatedWorkflow.updated_at,
      state: updatedWorkflow.state,
      message: 'Workflow state updated successfully',
    });

  } catch (error) {
    console.error('Error updating workflow state:', error);
    res.status(500).json({
      error: 'Failed to update workflow state',
      details: error.message,
    });
  }
});

/**
 * DELETE /api/workflows/:workflow_id
 * Delete a workflow (admin only)
 */
router.delete('/:workflow_id', [
  param('workflow_id').isUUID().withMessage('Valid workflow ID required'),
], validateRequest, async (req, res) => {
  try {
    const { workflow_id } = req.params;

    // Check if workflow exists
    const existingWorkflow = await orchestrator.getWorkflowStatus(workflow_id);
    if (!existingWorkflow) {
      return res.status(404).json({
        error: 'Workflow not found',
        workflow_id,
      });
    }

    // Only allow deletion of completed or failed workflows
    if (!['completed', 'failed'].includes(existingWorkflow.status)) {
      return res.status(400).json({
        error: 'Cannot delete workflow in current status',
        workflow_id,
        current_status: existingWorkflow.status,
        allowed_statuses: ['completed', 'failed'],
      });
    }

    // Delete workflow
    await dbService.deleteWorkflow(workflow_id);

    res.json({
      success: true,
      workflow_id,
      message: 'Workflow deleted successfully',
    });

  } catch (error) {
    console.error('Error deleting workflow:', error);
    res.status(500).json({
      error: 'Failed to delete workflow',
      details: error.message,
    });
  }
});

/**
 * POST /api/workflows/:workflow_id/cancel
 * Cancel a running workflow
 */
router.post('/:workflow_id/cancel', [
  param('workflow_id').isUUID().withMessage('Valid workflow ID required'),
  body('reason').optional().isString().withMessage('Reason must be a string'),
], validateRequest, async (req, res) => {
  try {
    const { workflow_id } = req.params;
    const { reason } = req.body;

    // Check if workflow exists
    const existingWorkflow = await orchestrator.getWorkflowStatus(workflow_id);
    if (!existingWorkflow) {
      return res.status(404).json({
        error: 'Workflow not found',
        workflow_id,
      });
    }

    // Only allow cancellation of running workflows
    if (existingWorkflow.status !== 'running') {
      return res.status(400).json({
        error: 'Cannot cancel workflow in current status',
        workflow_id,
        current_status: existingWorkflow.status,
      });
    }

    // Cancel workflow
    await dbService.updateWorkflow(workflow_id, {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason || 'Cancelled via API',
    });

    res.json({
      success: true,
      workflow_id,
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      reason: reason || 'Cancelled via API',
      message: 'Workflow cancelled successfully',
    });

  } catch (error) {
    console.error('Error cancelling workflow:', error);
    res.status(500).json({
      error: 'Failed to cancel workflow',
      details: error.message,
    });
  }
});

/**
 * GET /api/workflows/:workflow_id/history
 * Get workflow execution history
 */
router.get('/:workflow_id/history', [
  param('workflow_id').isUUID().withMessage('Valid workflow ID required'),
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
], validateRequest, async (req, res) => {
  try {
    const { workflow_id } = req.params;
    const { limit = 100 } = req.query;

    // Check if workflow exists
    const existingWorkflow = await orchestrator.getWorkflowStatus(workflow_id);
    if (!existingWorkflow) {
      return res.status(404).json({
        error: 'Workflow not found',
        workflow_id,
      });
    }

    // Get workflow history
    const history = await dbService.getWorkflowHistory(workflow_id, parseInt(limit));

    res.json({
      success: true,
      workflow_id,
      history,
      count: history.length,
    });

  } catch (error) {
    console.error('Error getting workflow history:', error);
    res.status(500).json({
      error: 'Failed to get workflow history',
      details: error.message,
    });
  }
});

export default router;