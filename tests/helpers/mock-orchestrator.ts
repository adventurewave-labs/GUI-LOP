export class MockLangGraphOrchestrator {
  private workflows: Map<string, any> = new Map();
  private failures: Set<string> = new Set();
  private stepResults: Map<string, any> = new Map();

  async initializeWorkflow(config: any): Promise<any> {
    const workflow = {
      id: `workflow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      config,
      status: 'initialized',
      currentStep: config.steps[0]?.id || 'initial',
      history: [],
      createdAt: new Date().toISOString()
    };

    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  async startWorkflow(workflowId: string, inputData?: any): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    workflow.status = 'running';
    workflow.inputData = inputData;
    workflow.startedAt = new Date().toISOString();

    // Simulate step execution
    await this.executeSteps(workflow);
  }

  async transitionState(workflowId: string, targetStep: string): Promise<any> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const previousStep = workflow.currentStep;
    workflow.currentStep = targetStep;
    workflow.history.push({
      from: previousStep,
      to: targetStep,
      timestamp: new Date().toISOString()
    });

    // Check if this step should fail
    if (this.failures.has(targetStep)) {
      workflow.status = 'error';
      throw new Error(`Step ${targetStep} failed`);
    }

    // Check if this is a HITL point
    const stepConfig = workflow.config.steps.find((step: any) => step.id === targetStep);
    if (stepConfig?.type === 'hitl') {
      workflow.status = 'paused';
      workflow.requiresHumanInput = true;
      workflow.pausedAt = targetStep;
    }

    return {
      currentState: targetStep,
      previousState: previousStep,
      status: workflow.status,
      requiresHumanInput: workflow.requiresHumanInput || false
    };
  }

  async resumeWithHumanInput(workflowId: string, input: any): Promise<any> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    workflow.status = 'running';
    workflow.requiresHumanInput = false;
    workflow.lastHumanInput = input;

    if (input.action === 'reject' && input.restartFrom) {
      workflow.currentStep = input.restartFrom;
      workflow.rejectionCount = (workflow.rejectionCount || 0) + 1;
    } else {
      // Continue to next step
      const currentStepIndex = workflow.config.steps.findIndex((step: any) => step.id === workflow.currentStep);
      const nextStep = workflow.config.steps[currentStepIndex + 1];
      if (nextStep) {
        workflow.currentStep = nextStep.id;
      } else {
        workflow.status = 'completed';
      }
    }

    return {
      status: workflow.status,
      currentStep: workflow.currentStep,
      lastHumanInput: input
    };
  }

  async getWorkflowStatus(workflowId: string): Promise<any> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    return {
      id: workflow.id,
      status: workflow.status,
      currentStep: workflow.currentStep,
      requiresHumanInput: workflow.requiresHumanInput || false,
      error: workflow.error,
      retryCount: workflow.retryCount || 0,
      rejectionCount: workflow.rejectionCount || 0
    };
  }

  async getWorkflowMetrics(workflowId: string): Promise<any> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const now = new Date().getTime();
    const started = workflow.startedAt ? new Date(workflow.startedAt).getTime() : now;
    const executionTime = now - started;

    return {
      executionTime,
      memoryUsage: {
        peak: Math.random() * 100 * 1024 * 1024, // Mock memory usage
        current: Math.random() * 50 * 1024 * 1024
      },
      stepsCompleted: workflow.history.length,
      totalSteps: workflow.config.steps.length
    };
  }

  // Mock methods for testing
  setStepToFail(stepId: string): void {
    this.failures.add(stepId);
  }

  setStepToSucceed(stepId: string): void {
    this.failures.delete(stepId);
  }

  setStepResult(stepId: string, result: any): void {
    this.stepResults.set(stepId, result);
  }

  reset(): void {
    this.workflows.clear();
    this.failures.clear();
    this.stepResults.clear();
  }

  private async executeSteps(workflow: any): Promise<void> {
    for (const step of workflow.config.steps) {
      if (step.type === 'automated') {
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000));

        if (this.failures.has(step.id)) {
          workflow.status = 'error';
          workflow.error = `Step ${step.id} failed`;
          return;
        }

        workflow.history.push({
          step: step.id,
          status: 'completed',
          timestamp: new Date().toISOString()
        });
      } else if (step.type === 'hitl') {
        workflow.currentStep = step.id;
        workflow.status = 'paused';
        workflow.requiresHumanInput = true;
        return;
      }
    }

    workflow.status = 'completed';
    workflow.completedAt = new Date().toISOString();
  }
}