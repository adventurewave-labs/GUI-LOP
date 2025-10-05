import { test, expect } from '@playwright/test';
import { WorkflowPage } from '../../helpers/page-objects/workflow-page.js';
import { DataAnalysisPage } from '../../helpers/page-objects/data-analysis-page.js';
import { ApprovalPage } from '../../helpers/page-objects/approval-page.js';

test.describe('Complete HITL Workflow E2E Tests', () => {
  let workflowPage: WorkflowPage;
  let dataAnalysisPage: DataAnalysisPage;
  let approvalPage: ApprovalPage;

  test.beforeEach(async ({ page }) => {
    workflowPage = new WorkflowPage(page);
    dataAnalysisPage = new DataAnalysisPage(page);
    approvalPage = new ApprovalPage(page);
  });

  test('should complete full data analysis workflow with human approval', async ({ page }) => {
    // 1. Navigate to application
    await page.goto('/');
    await expect(page).toHaveTitle(/GUI-LOP/);

    // 2. Start new data analysis workflow
    await workflowPage.navigateToWorkflows();
    await workflowPage.startNewWorkflow('data-analysis');

    // 3. Configure workflow parameters
    await workflowPage.configureWorkflow({
      dataSource: 'sales-database',
      dateRange: {
        start: '2024-01-01',
        end: '2024-03-31'
      },
      analysisType: 'trend-analysis',
      visualizationType: 'interactive-dashboard'
    });

    await workflowPage.startExecution();

    // 4. Wait for automated data collection phase
    await workflowPage.waitForStepCompletion('data-collection');
    expect(await workflowPage.getStepStatus('data-collection')).toBe('completed');

    // 5. Verify data analysis phase generates UI
    await workflowPage.waitForStep('data-analysis');
    const analysisUI = await workflowPage.getGeneratedUI();
    expect(analysisUI).toContain('streamlit');

    // 6. Interact with generated data visualization dashboard
    await dataAnalysisPage.waitForDashboardLoad();
    await expect(dataAnalysisPage.getChartContainer()).toBeVisible();

    // Verify dashboard components
    await expect(dataAnalysisPage.getMainChart()).toBeVisible();
    await expect(dataAnalysisPage.getFilterPanel()).toBeVisible();
    await expect(dataAnalysisPage.getExportButton()).toBeVisible();

    // 7. Test interactive features
    await dataAnalysisPage.applyFilter('region', 'North America');
    await dataAnalysisPage.waitForChartUpdate();

    const chartData = await dataAnalysisPage.getChartData();
    expect(chartData).toHaveProperty('filteredData');
    expect(chartData.filteredData.length).toBeGreaterThan(0);

    // 8. Export analysis results
    await dataAnalysisPage.exportResults('pdf');
    await expect(dataAnalysisPage.getExportConfirmation()).toBeVisible();

    // 9. Proceed to human review phase
    await workflowPage.proceedToNextStep();
    await workflowPage.waitForStep('human-review');

    // 10. Complete human review and approval
    await approvalPage.waitForReviewInterface();
    await expect(approvalPage.getAnalysisSummary()).toBeVisible();
    await expect(approvalPage.getRecommendationsPanel()).toBeVisible();

    // Review the analysis
    const summary = await approvalPage.getAnalysisSummary();
    expect(summary).toContain('trend analysis');
    expect(summary).toContain('North America');

    // Add human feedback
    await approvalPage.addFeedback({
      rating: 4,
      comments: 'Analysis is comprehensive and insights are valuable. Consider adding seasonal comparison.',
      suggestions: ['Add seasonal breakdown', 'Include competitor analysis']
    });

    // 11. Approve the workflow
    await approvalPage.approveAnalysis();

    // 12. Verify workflow completion
    await workflowPage.waitForStepCompletion('human-review');
    await workflowPage.waitForStepCompletion('final-report');

    const finalStatus = await workflowPage.getWorkflowStatus();
    expect(finalStatus).toBe('completed');

    // 13. Download final report
    await workflowPage.downloadFinalReport();
    const downloadEvent = await page.waitForEvent('download');
    expect(downloadEvent.suggestedFilename()).toMatch(/data-analysis-report.*\.pdf/);

    // 14. Verify workflow metrics
    const metrics = await workflowPage.getWorkflowMetrics();
    expect(metrics.totalDuration).toBeLessThan(300000); // < 5 minutes
    expect(metrics.uiGenerationTime).toBeLessThan(2000); // < 2 seconds
    expect(metrics.humanInteractionTime).toBeGreaterThan(0);
    expect(metrics.automatedProcessingTime).toBeGreaterThan(0);
  });

  test('should handle workflow rejection with restart from specific step', async ({ page }) => {
    // Start workflow
    await page.goto('/');
    await workflowPage.navigateToWorkflows();
    await workflowPage.startNewWorkflow('customer-churn-analysis');

    await workflowPage.configureWorkflow({
      dataSource: 'customer-database',
      analysisType: 'churn-prediction',
      modelType: 'random-forest'
    });

    await workflowPage.startExecution();

    // Wait for analysis completion
    await workflowPage.waitForStepCompletion('model-training');
    await workflowPage.waitForStep('human-review');

    // Reject the analysis
    await approvalPage.waitForReviewInterface();
    await approvalPage.rejectAnalysis({
      reason: 'Model accuracy is insufficient for production use',
      restartFrom: 'feature-engineering',
      suggestions: [
        'Include more customer interaction features',
        'Try different model algorithms',
        'Extend training data period'
      ]
    });

    // Verify workflow restarts from specified step
    await workflowPage.waitForStep('feature-engineering');
    expect(await workflowPage.getStepStatus('feature-engineering')).toBe('running');

    // Wait for re-execution
    await workflowPage.waitForStepCompletion('feature-engineering');
    await workflowPage.waitForStepCompletion('model-training');

    // Verify improved results
    await approvalPage.waitForReviewInterface();
    const improvedMetrics = await approvalPage.getModelMetrics();
    expect(improvedMetrics.accuracy).toBeGreaterThan(0.85); // Improved accuracy
  });

  test('should handle concurrent workflows in separate tabs', async ({ context }) => {
    // Create two separate browser contexts for concurrent workflows
    const [context1, context2] = await Promise.all([
      context.browser().newContext(),
      context.browser().newContext()
    ]);

    const [page1, page2] = await Promise.all([
      context1.newPage(),
      context2.newPage()
    ]);

    const workflowPage1 = new WorkflowPage(page1);
    const workflowPage2 = new WorkflowPage(page2);

    try {
      // Start workflow 1 - Sales Analysis
      await page1.goto('/');
      await workflowPage1.navigateToWorkflows();
      await workflowPage1.startNewWorkflow('sales-analysis');
      await workflowPage1.configureWorkflow({
        dataSource: 'sales-db',
        dateRange: { start: '2024-01-01', end: '2024-03-31' }
      });
      await workflowPage1.startExecution();

      // Start workflow 2 - Inventory Analysis
      await page2.goto('/');
      await workflowPage2.navigateToWorkflows();
      await workflowPage2.startNewWorkflow('inventory-analysis');
      await workflowPage2.configureWorkflow({
        dataSource: 'inventory-db',
        analysisType: 'stock-optimization'
      });
      await workflowPage2.startExecution();

      // Both workflows should run independently
      await Promise.all([
        workflowPage1.waitForStep('data-analysis'),
        workflowPage2.waitForStep('data-analysis')
      ]);

      // Verify both workflows have generated UIs
      const ui1 = await workflowPage1.getGeneratedUI();
      const ui2 = await workflowPage2.getGeneratedUI();

      expect(ui1).toContain('streamlit');
      expect(ui2).toContain('streamlit');

      // Complete both workflows
      await workflowPage1.proceedToNextStep();
      await workflowPage2.proceedToNextStep();

      await Promise.all([
        workflowPage1.waitForStep('human-review'),
        workflowPage2.waitForStep('human-review')
      ]);

      // Approve both workflows
      await approvalPage.approveAnalysis();
      await workflowPage1.proceedToNextStep();
      await workflowPage2.proceedToNextStep();

      // Verify both complete successfully
      await Promise.all([
        workflowPage1.waitForStepCompletion('final-report'),
        workflowPage2.waitForStepCompletion('final-report')
      ]);

      const status1 = await workflowPage1.getWorkflowStatus();
      const status2 = await workflowPage2.getWorkflowStatus();

      expect(status1).toBe('completed');
      expect(status2).toBe('completed');

    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('should handle workflow interruption and resume', async ({ page }) => {
    // Start a long-running workflow
    await page.goto('/');
    await workflowPage.navigateToWorkflows();
    await workflowPage.startNewWorkflow('comprehensive-report');

    await workflowPage.configureWorkflow({
      dataSource: 'multiple-sources',
      reportType: 'quarterly-business-review',
      includeSections: ['financial', 'operational', 'strategic', 'forecasting']
    });

    await workflowPage.startExecution();

    // Wait for workflow to reach an intermediate step
    await workflowPage.waitForStep('data-aggregation');

    // Simulate browser close/tab refresh
    await page.reload();

    // Verify workflow state is preserved
    await workflowPage.navigateToWorkflows();
    await workflowPage.selectWorkflow('comprehensive-report');

    const currentStep = await workflowPage.getCurrentStep();
    expect(currentStep).toBe('data-aggregation');

    // Verify we can resume from the saved state
    await workflowPage.resumeExecution();

    // Continue workflow to completion
    await workflowPage.waitForStepCompletion('data-aggregation');
    await workflowPage.waitForStep('report-generation');
    await workflowPage.waitForStepCompletion('report-generation');

    // Verify final output
    const finalReport = await workflowPage.getGeneratedReport();
    expect(finalReport).toHaveProperty('sections');
    expect(finalReport.sections).toContain('financial');
    expect(finalReport.sections).toContain('operational');
    expect(finalReport.sections).toContain('strategic');
    expect(finalReport.sections).toContain('forecasting');
  });

  test('should handle real-time collaboration features', async ({ context }) => {
    // Create two browser contexts to simulate collaboration
    const context1 = await context.browser().newContext();
    const context2 = await context.browser().newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const workflowPage1 = new WorkflowPage(page1);
    const workflowPage2 = new WorkflowPage(page2);

    try {
      // User 1 starts a collaborative workflow
      await page1.goto('/');
      await workflowPage1.navigateToWorkflows();
      await workflowPage1.startNewWorkflow('collaborative-analysis');
      await workflowPage1.configureWorkflow({
        collaborationMode: true,
        invitedUsers: ['user2@example.com'],
        dataSource: 'shared-database'
      });

      await workflowPage1.startExecution();
      await workflowPage1.waitForStep('collaborative-analysis');

      // User 2 joins the workflow
      await page2.goto('/');
      await workflowPage2.navigateToWorkflows();
      await workflowPage2.joinCollaborativeWorkflow('collaborative-analysis');

      // Both users should see the same UI
      const ui1 = await workflowPage1.getGeneratedUI();
      const ui2 = await workflowPage2.getGeneratedUI();
      expect(ui1).toBe(ui2);

      // User 1 makes a change
      await dataAnalysisPage.applyFilter('region', 'Europe');

      // User 2 should see the change in real-time
      await workflowPage2.waitForUIUpdate();
      const sharedState1 = await workflowPage1.getSharedState();
      const sharedState2 = await workflowPage2.getSharedState();
      expect(sharedState1).toEqual(sharedState2);

      // Both users add comments
      await workflowPage1.addComment('Great analysis! Let\'s add more detail to the Europe segment.');
      await workflowPage2.addComment('I agree. Also, could we compare this to last year?');

      // Verify both comments are visible to both users
      const comments1 = await workflowPage1.getComments();
      const comments2 = await workflowPage2.getComments();
      expect(comments1).toHaveLength(2);
      expect(comments2).toHaveLength(2);

      // Collaborative approval
      await workflowPage1.requestApproval();
      await workflowPage2.approveCollaborativeWorkflow({
        consensus: true,
        finalComments: 'Analysis is comprehensive and ready for presentation.'
      });

      // Verify workflow completion
      await workflowPage1.waitForStepCompletion('collaborative-approval');
      const status1 = await workflowPage1.getWorkflowStatus();
      const status2 = await workflowPage2.getWorkflowStatus();

      expect(status1).toBe('completed');
      expect(status2).toBe('completed');

    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('should validate UI generation performance requirements', async ({ page }) => {
    // Test UI generation timing
    await page.goto('/');
    await workflowPage.navigateToWorkflows();
    await workflowPage.startNewWorkflow('performance-test');

    // Measure UI generation time
    const startTime = Date.now();
    await workflowPage.startExecution();
    await workflowPage.waitForStep('data-visualization');
    const uiGenerationTime = Date.now() - startTime;

    // UI generation should be under 2 seconds as per requirements
    expect(uiGenerationTime).toBeLessThan(2000);

    // Verify UI quality and functionality
    await dataAnalysisPage.waitForDashboardLoad();
    await expect(dataAnalysisPage.getMainChart()).toBeVisible({ timeout: 5000 });

    // Test interactive responsiveness
    const interactionStartTime = Date.now();
    await dataAnalysisPage.applyFilter('date-range', 'last-30-days');
    await dataAnalysisPage.waitForChartUpdate();
    const interactionTime = Date.now() - interactionStartTime;

    // Interactions should be responsive (< 1 second)
    expect(interactionTime).toBeLessThan(1000);

    // Test memory usage (if available through browser metrics)
    const metrics = await page.evaluate(() => {
      if ('memory' in performance) {
        return (performance as any).memory;
      }
      return null;
    });

    if (metrics) {
      // Memory usage should be reasonable (< 100MB for this test)
      expect(metrics.usedJSHeapSize).toBeLessThan(100 * 1024 * 1024);
    }

    // Verify overall workflow performance
    const workflowMetrics = await workflowPage.getWorkflowMetrics();
    expect(workflowMetrics.uiGenerationTime).toBeLessThan(2000);
    expect(workflowMetrics.totalDuration).toBeLessThan(60000); // < 1 minute total
  });

  test('should handle error recovery gracefully', async ({ page }) => {
    // Configure workflow to experience errors
    await page.goto('/');
    await workflowPage.navigateToWorkflows();
    await workflowPage.startNewWorkflow('error-recovery-test');

    await workflowPage.configureWorkflow({
      dataSource: 'unreliable-source', // This will trigger errors
      retryPolicy: {
        maxRetries: 3,
        backoffStrategy: 'exponential'
      }
    });

    await workflowPage.startExecution();

    // Wait for error to occur
    await workflowPage.waitForError();

    // Verify error is displayed properly
    const errorMessage = await workflowPage.getErrorMessage();
    expect(errorMessage).toContain('Data source unavailable');

    // Verify retry options are presented
    const retryOptions = await workflowPage.getRetryOptions();
    expect(retryOptions).toContain('Retry');
    expect(retryOptions).toContain('Change Data Source');
    expect(retryOptions).toContain('Skip Step');

    // Choose to retry
    await workflowPage.retryOperation();

    // Wait for retry attempts
    await workflowPage.waitForRetryCompletion();

    // Verify retry count
    const retryCount = await workflowPage.getRetryCount();
    expect(retryCount).toBeGreaterThan(0);
    expect(retryCount).toBeLessThanOrEqual(3);

    // If retries fail, try alternative recovery
    if (await workflowPage.isStillInError()) {
      await workflowPage.changeDataSource('backup-source');
      await workflowPage.waitForStepCompletion('data-collection');
    }

    // Verify workflow recovers and continues
    await workflowPage.waitForStep('data-analysis');
    expect(await workflowPage.getWorkflowStatus()).toBe('running');
  });
});