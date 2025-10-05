import { Page, Locator } from '@playwright/test';

export class ApprovalPage {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // Review Interface
  async waitForReviewInterface(timeout: number = 10000): Promise<void> {
    await this.page.waitForSelector('[data-testid="approval-interface"]', { timeout });
    await this.page.waitForLoadState('networkidle');
  }

  getAnalysisSummary(): Locator {
    return this.page.locator('[data-testid="analysis-summary"]');
  }

  getRecommendationsPanel(): Locator {
    return this.page.locator('[data-testid="recommendations-panel"]');
  }

  getModelMetrics(): Locator {
    return this.page.locator('[data-testid="model-metrics"]');
  }

  // Review Actions
  async addFeedback(feedback: any): Promise<void> {
    if (feedback.rating !== undefined) {
      await this.page.click(`[data-testid="rating-${feedback.rating}"]`);
    }

    if (feedback.comments) {
      await this.page.fill('[data-testid="feedback-comments"]', feedback.comments);
    }

    if (feedback.suggestions) {
      for (const suggestion of feedback.suggestions) {
        await this.page.fill('[data-testid="suggestion-input"]', suggestion);
        await this.page.click('[data-testid="add-suggestion-button"]');
      }
    }

    await this.page.click('[data-testid="submit-feedback-button"]');
  }

  async approveAnalysis(): Promise<void> {
    await this.page.click('[data-testid="approve-analysis-button"]');
    await this.page.waitForSelector('[data-testid="approval-confirmed"]');
  }

  async rejectAnalysis(rejectionData: any): Promise<void> {
    if (rejectionData.reason) {
      await this.page.fill('[data-testid="rejection-reason"]', rejectionData.reason);
    }

    if (rejectionData.restartFrom) {
      await this.page.selectOption('[data-testid="restart-step-select"]', rejectionData.restartFrom);
    }

    if (rejectionData.suggestions) {
      for (const suggestion of rejectionData.suggestions) {
        await this.page.fill('[data-testid="rejection-suggestion"]', suggestion);
        await this.page.click('[data-testid="add-rejection-suggestion"]');
      }
    }

    await this.page.click('[data-testid="reject-analysis-button"]');
    await this.page.waitForSelector('[data-testid="rejection-confirmed"]');
  }

  // Review Information
  async getAnalysisDetails(): Promise<any> {
    const detailsElement = await this.page.locator('[data-testid="analysis-details"]');
    const detailsText = await detailsElement.textContent() || '{}';

    try {
      return JSON.parse(detailsText);
    } catch {
      return {
        title: '',
        description: '',
        methodology: '',
        findings: [],
        limitations: []
      };
    }
  }

  async getRecommendations(): Promise<string[]> {
    const recommendationElements = await this.page.locator('[data-testid="recommendation-item"]').all();
    const recommendations: string[] = [];

    for (const element of recommendationElements) {
      recommendations.push(await element.textContent() || '');
    }

    return recommendations;
  }

  async getRiskAssessment(): Promise<any> {
    const riskElement = await this.page.locator('[data-testid="risk-assessment"]');
    const riskText = await riskElement.textContent() || '{}';

    try {
      return JSON.parse(riskText);
    } catch {
      return {
        overallRisk: 'low',
        riskFactors: [],
        mitigations: []
      };
    }
  }

  // Quality Checks
  async performQualityCheck(): Promise<any> {
    await this.page.click('[data-testid="quality-check-button"]');
    await this.page.waitForSelector('[data-testid="quality-check-results"]');

    const resultsElement = await this.page.locator('[data-testid="quality-check-results"]');
    const resultsText = await resultsElement.textContent() || '{}';

    try {
      return JSON.parse(resultsText);
    } catch {
      return {
        overallScore: 0,
        checks: [],
        passed: false
      };
    }
  }

  async requestAdditionalAnalysis(analysisType: string, description: string): Promise<void> {
    await this.page.click('[data-testid="request-additional-analysis"]');
    await this.page.selectOption('[data-testid="analysis-type-select"]', analysisType);
    await this.page.fill('[data-testid="analysis-description"]', description);
    await this.page.click('[data-testid="submit-analysis-request"]');
  }

  // Collaboration Features
  async startCollaborativeReview(): Promise<void> {
    await this.page.click('[data-testid="start-collaborative-review"]');
    await this.page.waitForSelector('[data-testid="collaboration-panel"]');
  }

  async inviteReviewer(email: string): Promise<void> {
    await this.page.fill('[data-testid="reviewer-email-input"]', email);
    await this.page.click('[data-testid="invite-reviewer-button"]');
  }

  async addComment(section: string, comment: string): Promise<void> {
    await this.page.click(`[data-testid="comment-section-${section}"]`);
    await this.page.fill('[data-testid="comment-input"]', comment);
    await this.page.click('[data-testid="submit-comment"]');
  }

  async getComments(): Promise<any[]> {
    const commentElements = await this.page.locator('[data-testid="comment-item"]').all();
    const comments: any[] = [];

    for (const element of commentElements) {
      const commentText = await element.textContent() || '';
      const authorElement = await element.locator('[data-testid="comment-author"]');
      const timestampElement = await element.locator('[data-testid="comment-timestamp"]');

      comments.push({
        text: commentText,
        author: await authorElement.textContent() || '',
        timestamp: await timestampElement.textContent() || ''
      });
    }

    return comments;
  }

  async resolveComment(commentId: string): Promise<void> {
    await this.page.click(`[data-testid="resolve-comment-${commentId}"]`);
  }

  // Approval Workflow
  async setApprovalConditions(conditions: any[]): Promise<void> {
    await this.page.click('[data-testid="set-approval-conditions"]');

    for (const condition of conditions) {
      await this.page.fill('[data-testid="condition-description"]', condition.description);
      await this.page.selectOption('[data-testid="condition-type"]', condition.type);
      await this.page.click('[data-testid="add-condition-button"]');
    }

    await this.page.click('[data-testid="save-conditions"]');
  }

  async delegateApproval(delegateEmail: string, reason: string): Promise<void> {
    await this.page.click('[data-testid="delegate-approval-button"]');
    await this.page.fill('[data-testid="delegate-email"]', delegateEmail);
    await this.page.fill('[data-testid="delegation-reason"]', reason);
    await this.page.click('[data-testid="confirm-delegation"]');
  }

  async scheduleFollowUp(date: string, notes: string): Promise<void> {
    await this.page.click('[data-testid="schedule-follow-up"]');
    await this.page.fill('[data-testid="follow-up-date"]', date);
    await this.page.fill('[data-testid="follow-up-notes"]', notes);
    await this.page.click('[data-testid="save-follow-up"]');
  }

  // Documentation and Evidence
  async uploadEvidence(filePaths: string[]): Promise<void> {
    await this.page.click('[data-testid="upload-evidence-button"]');

    for (const filePath of filePaths) {
      await this.page.setInputFiles('[data-testid="evidence-file-input"]', filePath);
      await this.page.click('[data-testid="add-evidence-file"]');
    }

    await this.page.click('[data-testid="confirm-evidence-upload"]');
  }

  async getEvidenceList(): Promise<any[]> {
    const evidenceElements = await this.page.locator('[data-testid="evidence-item"]').all();
    const evidence: any[] = [];

    for (const element of evidenceElements) {
      const nameElement = await element.locator('[data-testid="evidence-name"]');
      const sizeElement = await element.locator('[data-testid="evidence-size"]');
      const uploadDateElement = await element.locator('[data-testid="evidence-upload-date"]');

      evidence.push({
        name: await nameElement.textContent() || '',
        size: await sizeElement.textContent() || '',
        uploadDate: await uploadDateElement.textContent() || ''
      });
    }

    return evidence;
  }

  async addDocumentationNote(note: string): Promise<void> {
    await this.page.fill('[data-testid="documentation-note"]', note);
    await this.page.click('[data-testid="save-documentation-note"]');
  }

  // Audit Trail
  async getAuditTrail(): Promise<any[]> {
    await this.page.click('[data-testid="view-audit-trail"]');
    await this.page.waitForSelector('[data-testid="audit-trail-list"]');

    const auditElements = await this.page.locator('[data-testid="audit-trail-item"]').all();
    const auditTrail: any[] = [];

    for (const element of auditElements) {
      const actionElement = await element.locator('[data-testid="audit-action"]');
      const userElement = await element.locator('[data-testid="audit-user"]');
      const timestampElement = await element.locator('[data-testid="audit-timestamp"]');

      auditTrail.push({
        action: await actionElement.textContent() || '',
        user: await userElement.textContent() || '',
        timestamp: await timestampElement.textContent() || ''
      });
    }

    return auditTrail;
  }

  // Compliance and Validation
  async performComplianceCheck(standards: string[]): Promise<any> {
    await this.page.click('[data-testid="compliance-check-button"]');

    for (const standard of standards) {
      await this.page.check(`[data-testid="compliance-standard-${standard}"]`);
    }

    await this.page.click('[data-testid="run-compliance-check"]');
    await this.page.waitForSelector('[data-testid="compliance-results"]');

    const resultsElement = await this.page.locator('[data-testid="compliance-results"]');
    const resultsText = await resultsElement.textContent() || '{}';

    try {
      return JSON.parse(resultsText);
    } catch {
      return {
        compliant: false,
        violations: [],
        recommendations: []
      };
    }
  }

  // Status and Progress
  async getApprovalStatus(): Promise<string> {
    const statusElement = await this.page.locator('[data-testid="approval-status"]');
    return await statusElement.getAttribute('data-status') || 'pending';
  }

  async getReviewProgress(): Promise<any> {
    const progressElement = await this.page.locator('[data-testid="review-progress"]');
    const progressText = await progressElement.textContent() || '{}';

    try {
      return JSON.parse(progressText);
    } catch {
      return {
        completed: 0,
        total: 0,
        percentage: 0
      };
    }
  }

  async isApprovalComplete(): Promise<boolean> {
    const status = await this.getApprovalStatus();
    return status === 'approved' || status === 'rejected';
  }

  // Utility Methods
  async waitForApprovalDecision(timeout: number = 60000): Promise<void> {
    await this.page.waitForSelector(
      '[data-testid="approval-status"][data-status="approved"], [data-testid="approval-status"][data-status="rejected"]',
      { timeout }
    );
  }

  async cancelApproval(): Promise<void> {
    await this.page.click('[data-testid="cancel-approval-button"]');
    await this.page.waitForSelector('[data-testid="approval-cancelled"]');
  }

  async saveForLater(): Promise<void> {
    await this.page.click('[data-testid="save-for-later-button"]');
    await this.page.waitForSelector('[data-testid="approval-saved"]');
  }

  async exportApprovalReport(format: string): Promise<void> {
    await this.page.click('[data-testid="export-approval-report"]');
    await this.page.click(`[data-testid="export-format-${format}"]`);
    await this.page.click('[data-testid="confirm-export"]');
  }

  async takeScreenshot(filename: string): Promise<void> {
    await this.page.screenshot({ path: `test-results/screenshots/approval-${filename}` });
  }
}