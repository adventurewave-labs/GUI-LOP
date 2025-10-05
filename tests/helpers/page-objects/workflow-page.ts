import { Page, Locator } from '@playwright/test';

export class WorkflowPage {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // Navigation
  async navigateToWorkflows(): Promise<void> {
    await this.page.click('[data-testid="workflows-nav"]');
    await this.page.waitForLoadState('networkidle');
  }

  async startNewWorkflow(workflowType: string): Promise<void> {
    await this.page.click('[data-testid="new-workflow-button"]');
    await this.page.fill('[data-testid="workflow-type-select"]', workflowType);
    await this.page.click(`[data-testid="workflow-type-${workflowType}"]`);
    await this.page.click('[data-testid="create-workflow-button"]');
    await this.page.waitForLoadState('networkidle');
  }

  // Workflow Configuration
  async configureWorkflow(config: any): Promise<void> {
    if (config.dataSource) {
      await this.page.fill('[data-testid="data-source-input"]', config.dataSource);
    }

    if (config.dateRange) {
      await this.page.fill('[data-testid="date-range-start"]', config.dateRange.start);
      await this.page.fill('[data-testid="date-range-end"]', config.dateRange.end);
    }

    if (config.analysisType) {
      await this.page.selectOption('[data-testid="analysis-type-select"]', config.analysisType);
    }

    if (config.visualizationType) {
      await this.page.selectOption('[data-testid="visualization-type-select"]', config.visualizationType);
    }

    if (config.modelType) {
      await this.page.selectOption('[data-testid="model-type-select"]', config.modelType);
    }

    if (config.collaborationMode) {
      await this.page.check('[data-testid="collaboration-mode-checkbox"]');
    }

    if (config.invitedUsers) {
      for (const user of config.invitedUsers) {
        await this.page.fill('[data-testid="invite-user-input"]', user);
        await this.page.click('[data-testid="invite-user-button"]');
      }
    }

    await this.page.click('[data-testid="configure-workflow-button"]');
  }

  // Workflow Execution
  async startExecution(): Promise<void> {
    await this.page.click('[data-testid="start-workflow-button"]');
    await this.page.waitForSelector('[data-testid="workflow-execution-status"]');
  }

  async resumeExecution(): Promise<void> {
    await this.page.click('[data-testid="resume-workflow-button"]');
    await this.page.waitForSelector('[data-testid="workflow-execution-status"]');
  }

  async proceedToNextStep(): Promise<void> {
    await this.page.click('[data-testid="proceed-to-next-step-button"]');
    await this.page.waitForLoadState('networkidle');
  }

  // Step Management
  async waitForStep(stepId: string, timeout: number = 30000): Promise<void> {
    await this.page.waitForSelector(`[data-testid="step-${stepId}"]`, { timeout });
  }

  async waitForStepCompletion(stepId: string, timeout: number = 60000): Promise<void> {
    await this.page.waitForSelector(
      `[data-testid="step-${stepId}"][data-status="completed"]`,
      { timeout }
    );
  }

  async waitForError(timeout: number = 30000): Promise<void> {
    await this.page.waitForSelector('[data-testid="workflow-error"]', { timeout });
  }

  async waitForRetryCompletion(timeout: number = 60000): Promise<void> {
    await this.page.waitForSelector(
      '[data-testid="workflow-status"][data-status="running"]',
      { timeout }
    );
  }

  // Status and Information
  async getWorkflowStatus(): Promise<string> {
    const statusElement = await this.page.locator('[data-testid="workflow-status"]');
    return await statusElement.getAttribute('data-status') || 'unknown';
  }

  async getCurrentStep(): Promise<string> {
    const stepElement = await this.page.locator('[data-testid="current-step"]');
    return await stepElement.textContent() || 'unknown';
  }

  async getStepStatus(stepId: string): Promise<string> {
    const stepElement = await this.page.locator(`[data-testid="step-${stepId}"]`);
    return await stepElement.getAttribute('data-status') || 'unknown';
  }

  async getGeneratedUI(): Promise<string> {
    const uiElement = await this.page.locator('[data-testid="generated-ui"]');
    return await uiElement.innerHTML();
  }

  async getWorkflowMetrics(): Promise<any> {
    const metricsElement = await this.page.locator('[data-testid="workflow-metrics"]');
    const metricsText = await metricsElement.textContent() || '{}';

    try {
      return JSON.parse(metricsText);
    } catch {
      return {
        totalDuration: 0,
        uiGenerationTime: 0,
        humanInteractionTime: 0,
        automatedProcessingTime: 0
      };
    }
  }

  async getErrorMessage(): Promise<string> {
    const errorElement = await this.page.locator('[data-testid="workflow-error-message"]');
    return await errorElement.textContent() || '';
  }

  async getRetryOptions(): Promise<string[]> {
    const optionsElements = await this.page.locator('[data-testid="retry-option"]').all();
    const options: string[] = [];

    for (const element of optionsElements) {
      options.push(await element.textContent() || '');
    }

    return options;
  }

  async getRetryCount(): Promise<number> {
    const retryElement = await this.page.locator('[data-testid="retry-count"]');
    const retryText = await retryElement.textContent() || '0';
    return parseInt(retryText, 10) || 0;
  }

  // Error Handling
  async retryOperation(): Promise<void> {
    await this.page.click('[data-testid="retry-button"]');
  }

  async changeDataSource(newSource: string): Promise<void> {
    await this.page.click('[data-testid="change-data-source-button"]');
    await this.page.fill('[data-testid="new-data-source-input"]', newSource);
    await this.page.click('[data-testid="confirm-data-source-change"]');
  }

  async isStillInError(): Promise<boolean> {
    const errorElement = await this.page.locator('[data-testid="workflow-error"]');
    return await errorElement.isVisible();
  }

  // Collaboration
  async joinCollaborativeWorkflow(workflowName: string): Promise<void> {
    await this.page.click('[data-testid="join-workflow-button"]');
    await this.page.fill('[data-testid="workflow-search-input"]', workflowName);
    await this.page.click(`[data-testid="workflow-${workflowName}"]`);
    await this.page.click('[data-testid="confirm-join-workflow"]');
  }

  async waitForUIUpdate(timeout: number = 10000): Promise<void> {
    await this.page.waitForSelector('[data-testid="ui-updated"]', { timeout });
  }

  async getSharedState(): Promise<any> {
    const stateElement = await this.page.locator('[data-testid="shared-state"]');
    const stateText = await stateElement.textContent() || '{}';

    try {
      return JSON.parse(stateText);
    } catch {
      return {};
    }
  }

  async addComment(comment: string): Promise<void> {
    await this.page.fill('[data-testid="comment-input"]', comment);
    await this.page.click('[data-testid="submit-comment-button"]');
  }

  async getComments(): Promise<string[]> {
    const commentElements = await this.page.locator('[data-testid="comment"]').all();
    const comments: string[] = [];

    for (const element of commentElements) {
      comments.push(await element.textContent() || '');
    }

    return comments;
  }

  async requestApproval(): Promise<void> {
    await this.page.click('[data-testid="request-approval-button"]');
  }

  async approveCollaborativeWorkflow(approvalData: any): Promise<void> {
    if (approvalData.finalComments) {
      await this.page.fill('[data-testid="final-comments-input"]', approvalData.finalComments);
    }

    await this.page.click('[data-testid="approve-collaborative-workflow-button"]');
  }

  // Workflow Selection and Management
  async selectWorkflow(workflowName: string): Promise<void> {
    await this.page.click(`[data-testid="workflow-${workflowName}"]`);
  }

  async downloadFinalReport(): Promise<void> {
    await this.page.click('[data-testid="download-report-button"]');
  }

  async getGeneratedReport(): Promise<any> {
    const reportElement = await this.page.locator('[data-testid="generated-report"]');
    const reportText = await reportElement.textContent() || '{}';

    try {
      return JSON.parse(reportText);
    } catch {
      return { sections: [] };
    }
  }

  // Advanced Features
  async waitForDataProcessing(timeout: number = 120000): Promise<void> {
    await this.page.waitForSelector(
      '[data-testid="data-processing-status"][data-status="completed"]',
      { timeout }
    );
  }

  async waitForUIGeneration(timeout: number = 5000): Promise<void> {
    await this.page.waitForSelector(
      '[data-testid="ui-generation-status"][data-status="completed"]',
      { timeout }
    );
  }

  async getProcessingDetails(): Promise<any> {
    const detailsElement = await this.page.locator('[data-testid="processing-details"]');
    const detailsText = await detailsElement.textContent() || '{}';

    try {
      return JSON.parse(detailsText);
    } catch {
      return {
        recordsProcessed: 0,
        processingTime: 0,
        errors: []
      };
    }
  }

  // Utility Methods
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  async takeScreenshot(filename: string): Promise<void> {
    await this.page.screenshot({ path: `test-results/screenshots/${filename}` });
  }

  async waitForElement(selector: string, timeout: number = 10000): Promise<Locator> {
    await this.page.waitForSelector(selector, { timeout });
    return this.page.locator(selector);
  }

  async isElementVisible(selector: string): Promise<boolean> {
    return await this.page.locator(selector).isVisible();
  }

  async getElementText(selector: string): Promise<string> {
    return await this.page.locator(selector).textContent() || '';
  }

  async clickElement(selector: string): Promise<void> {
    await this.page.click(selector);
  }

  async fillInput(selector: string, value: string): Promise<void> {
    await this.page.fill(selector, value);
  }

  async selectOption(selector: string, value: string): Promise<void> {
    await this.page.selectOption(selector, value);
  }

  async checkCheckbox(selector: string): Promise<void> {
    await this.page.check(selector);
  }

  async uncheckCheckbox(selector: string): Promise<void> {
    await this.page.uncheck(selector);
  }
}