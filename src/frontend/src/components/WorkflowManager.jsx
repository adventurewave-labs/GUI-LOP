import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { aguiEventService, AGUI_EVENTS } from '../services/events';

/**
 * Workflow States
 */
export const WORKFLOW_STATES = {
  IDLE: 'idle',
  INITIALIZING: 'initializing',
  RUNNING: 'running',
  PAUSED: 'paused',
  WAITING_FOR_INPUT: 'waiting_for_input',
  WAITING_FOR_APPROVAL: 'waiting_for_approval',
  COMPLETED: 'completed',
  ERROR: 'error',
  CANCELLED: 'cancelled'
};

/**
 * WorkflowManager - Manages HITL workflow state and orchestration
 * Handles workflow transitions, checkpoints, and human collaboration points
 */
const WorkflowManager = ({
  sessionId,
  onStateChange,
  onStepComplete,
  onWorkflowComplete,
  children
}) => {
  const [workflowState, setWorkflowState] = useState({
    state: WORKFLOW_STATES.IDLE,
    currentStep: null,
    steps: [],
    metadata: {},
    startTime: null,
    endTime: null
  });

  const [workflowHistory, setWorkflowHistory] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [activeCollaboration, setActiveCollaboration] = useState(null);

  // Update workflow state
  const updateWorkflowState = useCallback((newState, step = null, metadata = {}) => {
    const updatedState = {
      ...workflowState,
      state: newState,
      currentStep: step || workflowState.currentStep,
      metadata: { ...workflowState.metadata, ...metadata },
      lastUpdated: new Date().toISOString()
    };

    // Set timestamps for specific states
    if (newState === WORKFLOW_STATES.RUNNING && !workflowState.startTime) {
      updatedState.startTime = new Date().toISOString();
    } else if ([WORKFLOW_STATES.COMPLETED, WORKFLOW_STATES.ERROR, WORKFLOW_STATES.CANCELLED].includes(newState)) {
      updatedState.endTime = new Date().toISOString();
    }

    setWorkflowState(updatedState);

    // Add to history
    setWorkflowHistory(prev => [...prev, {
      timestamp: new Date().toISOString(),
      state: newState,
      step,
      metadata
    }]);

    // Notify parent
    onStateChange?.(updatedState);

    // Emit AG-UI event
    const event = aguiEventService.createWorkflowStateEvent(sessionId, newState, step, metadata);
    aguiEventService.emit(event);
  }, [workflowState, sessionId, onStateChange]);

  // Handle workflow initialization
  const initializeWorkflow = useCallback((workflowConfig) => {
    updateWorkflowState(WORKFLOW_STATES.INITIALIZING, null, { workflowConfig });

    const steps = workflowConfig.steps || [];
    setCheckpoints(workflowConfig.checkpoints || []);

    updateWorkflowState(WORKFLOW_STATES.RUNNING, steps[0]?.id, {
      totalSteps: steps.length,
      workflowId: workflowConfig.id
    });
  }, [updateWorkflowState]);

  // Handle step completion
  const completeStep = useCallback((stepId, result = {}) => {
    const currentStepIndex = workflowState.steps.findIndex(step => step.id === stepId);
    const nextStep = workflowState.steps[currentStepIndex + 1];

    // Add step result to metadata
    const stepResults = workflowState.metadata.stepResults || {};
    stepResults[stepId] = {
      completedAt: new Date().toISOString(),
      result
    };

    if (nextStep) {
      // Move to next step
      updateWorkflowState(WORKFLOW_STATES.RUNNING, nextStep.id, {
        stepResults,
        completedSteps: currentStepIndex + 1
      });
    } else {
      // Workflow completed
      updateWorkflowState(WORKFLOW_STATES.COMPLETED, null, {
        stepResults,
        completedSteps: workflowState.steps.length
      });
      onWorkflowComplete?.(stepResults);
    }

    onStepComplete?.(stepId, result);
  }, [workflowState, updateWorkflowState, onStepComplete, onWorkflowComplete]);

  // Handle checkpoint reached
  const handleCheckpoint = useCallback((checkpointId, checkpointData) => {
    const checkpoint = checkpoints.find(cp => cp.id === checkpointId);
    if (!checkpoint) return;

    updateWorkflowState(WORKFLOW_STATES.PAUSED, workflowState.currentStep, {
      activeCheckpoint: checkpointId,
      checkpointData
    });

    // If checkpoint requires human interaction
    if (checkpoint.requiresHumanInteraction) {
      setActiveCollaboration({
        type: 'checkpoint',
        id: checkpointId,
        description: checkpoint.description,
        options: checkpoint.options || [],
        data: checkpointData
      });
      updateWorkflowState(WORKFLOW_STATES.WAITING_FOR_APPROVAL, workflowState.currentStep);
    }
  }, [checkpoints, workflowState.currentStep, updateWorkflowState]);

  // Handle tool input required
  const handleToolInputRequired = useCallback((toolId, inputSchema) => {
    updateWorkflowState(WORKFLOW_STATES.WAITING_FOR_INPUT, workflowState.currentStep, {
      requiredTool: toolId,
      inputSchema
    });

    setActiveCollaboration({
      type: 'tool_input',
      toolId,
      inputSchema
    });
  }, [workflowState.currentStep, updateWorkflowState]);

  // Handle approval required
  const handleApprovalRequired = useCallback((message, options = {}) => {
    updateWorkflowState(WORKFLOW_STATES.WAITING_FOR_APPROVAL, workflowState.currentStep, {
      approvalMessage: message,
      approvalOptions: options
    });

    setActiveCollaboration({
      type: 'approval',
      message,
      options
    });
  }, [workflowState.currentStep, updateWorkflowState]);

  // Respond to collaboration requests
  const respondToCollaboration = useCallback((response) => {
    if (!activeCollaboration) return;

    const { type } = activeCollaboration;

    switch (type) {
      case 'checkpoint':
      case 'approval':
        if (response.approved) {
          updateWorkflowState(WORKFLOW_STATES.RUNNING, workflowState.currentStep);
        } else {
          updateWorkflowState(WORKFLOW_STATES.PAUSED, workflowState.currentStep, {
            rejectionReason: response.reason
          });
        }
        break;

      case 'tool_input':
        // Resume workflow with tool input
        updateWorkflowState(WORKFLOW_STATES.RUNNING, workflowState.currentStep, {
          toolInput: response.input
        });
        break;

      default:
        console.warn('Unknown collaboration type:', type);
    }

    setActiveCollaboration(null);
  }, [activeCollaboration, workflowState.currentStep, updateWorkflowState]);

  // Pause workflow
  const pauseWorkflow = useCallback(() => {
    updateWorkflowState(WORKFLOW_STATES.PAUSED, workflowState.currentStep, {
      pauseReason: 'manual'
    });
  }, [workflowState.currentStep, updateWorkflowState]);

  // Resume workflow
  const resumeWorkflow = useCallback(() => {
    updateWorkflowState(WORKFLOW_STATES.RUNNING, workflowState.currentStep);
  }, [workflowState.currentStep, updateWorkflowState]);

  // Cancel workflow
  const cancelWorkflow = useCallback((reason = 'manual') => {
    updateWorkflowState(WORKFLOW_STATES.CANCELLED, null, {
      cancelReason: reason
    });
    setActiveCollaboration(null);
  }, [updateWorkflowState]);

  // Reset workflow
  const resetWorkflow = useCallback(() => {
    setWorkflowState({
      state: WORKFLOW_STATES.IDLE,
      currentStep: null,
      steps: [],
      metadata: {},
      startTime: null,
      endTime: null
    });
    setWorkflowHistory([]);
    setActiveCollaboration(null);
  }, []);

  // Register AG-UI event handlers
  useEffect(() => {
    const unregisterFunctions = [
      aguiEventService.registerEventHandler(AGUI_EVENTS.WORKFLOW_STATE, (event) => {
        const { state, step, metadata } = event.payload;
        setWorkflowState(prev => ({
          ...prev,
          state,
          currentStep: step,
          metadata: { ...prev.metadata, ...metadata }
        }));
      }),

      aguiEventService.registerEventHandler(AGUI_EVENTS.APPROVAL_REQUEST, (event) => {
        const { message, options } = event.payload;
        handleApprovalRequired(message, options);
      }),

      aguiEventService.registerEventHandler(AGUI_EVENTS.TOOL_INPUT_REQUEST, (event) => {
        const { toolId, inputSchema } = event.payload;
        handleToolInputRequired(toolId, inputSchema);
      }),

      aguiEventService.registerEventHandler(AGUI_EVENTS.ERROR, (event) => {
        updateWorkflowState(WORKFLOW_STATES.ERROR, workflowState.currentStep, {
          error: event.payload.error
        });
      })
    ];

    return () => {
      unregisterFunctions.forEach(unregister => unregister());
    };
  }, [
    handleApprovalRequired,
    handleToolInputRequired,
    updateWorkflowState,
    workflowState.currentStep
  ]);

  // Context value for components
  const contextValue = {
    workflowState,
    workflowHistory,
    checkpoints,
    activeCollaboration,
    initializeWorkflow,
    completeStep,
    handleCheckpoint,
    respondToCollaboration,
    pauseWorkflow,
    resumeWorkflow,
    cancelWorkflow,
    resetWorkflow,
    isRunning: workflowState.state === WORKFLOW_STATES.RUNNING,
    isPaused: workflowState.state === WORKFLOW_STATES.PAUSED,
    isWaitingForInput: workflowState.state === WORKFLOW_STATES.WAITING_FOR_INPUT,
    isWaitingForApproval: workflowState.state === WORKFLOW_STATES.WAITING_FOR_APPROVAL,
    isCompleted: workflowState.state === WORKFLOW_STATES.COMPLETED,
    hasError: workflowState.state === WORKFLOW_STATES.ERROR
  };

  return (
    <WorkflowContext.Provider value={contextValue}>
      {children}
    </WorkflowContext.Provider>
  );
};

// Context for sharing workflow state
const WorkflowContext = createContext();

/**
 * Hook for accessing workflow functionality
 */
export const useWorkflow = () => {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error('useWorkflow must be used within WorkflowManager');
  }
  return context;
};

/**
 * Workflow progress component
 */
export const WorkflowProgress = () => {
  const { workflowState, workflowHistory } = useWorkflow();

  const calculateProgress = () => {
    if (!workflowState.metadata.totalSteps) return 0;
    const completed = workflowState.metadata.completedSteps || 0;
    return (completed / workflowState.metadata.totalSteps) * 100;
  };

  const getStateColor = (state) => {
    switch (state) {
      case WORKFLOW_STATES.RUNNING: return '#28a745';
      case WORKFLOW_STATES.PAUSED: return '#ffc107';
      case WORKFLOW_STATES.WAITING_FOR_INPUT:
      case WORKFLOW_STATES.WAITING_FOR_APPROVAL: return '#17a2b8';
      case WORKFLOW_STATES.COMPLETED: return '#28a745';
      case WORKFLOW_STATES.ERROR: return '#dc3545';
      case WORKFLOW_STATES.CANCELLED: return '#6c757d';
      default: return '#6c757d';
    }
  };

  return (
    <div className="workflow-progress">
      <div className="workflow-header">
        <h4>Workflow Status</h4>
        <div className="workflow-state" style={{ color: getStateColor(workflowState.state) }}>
          {workflowState.state.replace(/_/g, ' ').toUpperCase()}
        </div>
      </div>

      {workflowState.metadata.totalSteps && (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${calculateProgress()}%` }}></div>
          <span className="progress-text">
            {workflowState.metadata.completedSteps || 0} / {workflowState.metadata.totalSteps} steps
          </span>
        </div>
      )}

      {workflowState.currentStep && (
        <div className="current-step">
          <strong>Current Step:</strong> {workflowState.currentStep}
        </div>
      )}

      {workflowState.startTime && (
        <div className="workflow-timing">
          <small>
            Started: {new Date(workflowState.startTime).toLocaleString()}
            {workflowState.endTime && (
              <> • Duration: {Math.round((new Date(workflowState.endTime) - new Date(workflowState.startTime)) / 1000)}s</>
            )}
          </small>
        </div>
      )}

      <style jsx>{`
        .workflow-progress {
          padding: 16px;
          background: #f8f9fa;
          border-radius: 8px;
          margin-bottom: 16px;
        }

        .workflow-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .workflow-header h4 {
          margin: 0;
        }

        .workflow-state {
          font-weight: bold;
          text-transform: uppercase;
          font-size: 12px;
        }

        .progress-bar {
          position: relative;
          height: 20px;
          background: #e9ecef;
          border-radius: 10px;
          margin-bottom: 8px;
        }

        .progress-fill {
          height: 100%;
          background: #28a745;
          border-radius: 10px;
          transition: width 0.3s ease;
        }

        .progress-text {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 12px;
          font-weight: bold;
          color: #333;
        }

        .current-step {
          margin-bottom: 8px;
        }

        .workflow-timing {
          color: #6c757d;
        }
      `}</style>
    </div>
  );
};

export default WorkflowManager;