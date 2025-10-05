/**
 * LangGraph Workflow Orchestration
 * Implements HITL workflows with interrupt points for human collaboration
 */

import { StateGraph, END } from '@langchain/langgraph';
import { RunnablePassthrough, RunnableLambda } from '@langchain/core/runnables';
import { v4 as uuidv4 } from 'uuid';

// Import UI generation tools
import { UIGenerator } from './ui-generator.js';
import { DatabaseService } from '../services/database.js';

class WorkflowOrchestrator {
  constructor(dbService, aguiService) {
    this.dbService = dbService;
    this.aguiService = aguiService;
    this.uiGenerator = new UIGenerator();
    this.activeWorkflows = new Map();
    this.pausedWorkflows = new Map();

    // Initialize workflow templates
    this.workflowTemplates = new Map();
    this.setupWorkflowTemplates();
  }

  setupWorkflowTemplates() {
    // Data Analysis Workflow Template
    this.workflowTemplates.set('data-analysis', {
      name: 'Data Analysis with Human Insights',
      description: 'Analyze data, generate insights, and request human validation',
      initial_state: {
        data: null,
        analysis: null,
        insights: null,
        human_feedback: null,
        approval: null,
        ui_components: [],
      },
      nodes: [
        'data_ingestion',
        'initial_analysis',
        'generate_insights',
        'human_approval',
        'final_processing',
        'completion'
      ],
      edges: [
        ['data_ingestion', 'initial_analysis'],
        ['initial_analysis', 'generate_insights'],
        ['generate_insights', 'human_approval'],
        ['human_approval', 'final_processing'],
        ['final_processing', 'completion']
      ],
      interrupt_before: ['human_approval'],
      interrupt_after: ['generate_insights']
    });

    // Decision Making Workflow Template
    this.workflowTemplates.set('decision-making', {
      name: 'Collaborative Decision Making',
      description: 'Gather information, present options, and make decisions with human input',
      initial_state: {
        context: null,
        options: null,
        human_choice: null,
        reasoning: null,
        confidence: null,
        ui_components: [],
      },
      nodes: [
        'context_analysis',
        'option_generation',
        'human_selection',
        'reasoning_generation',
        'confidence_assessment',
        'completion'
      ],
      edges: [
        ['context_analysis', 'option_generation'],
        ['option_generation', 'human_selection'],
        ['human_selection', 'reasoning_generation'],
        ['reasoning_generation', 'confidence_assessment'],
        ['confidence_assessment', 'completion']
      ],
      interrupt_before: ['human_selection'],
      interrupt_after: ['option_generation']
    });

    // Content Creation Workflow Template
    this.workflowTemplates.set('content-creation', {
      name: 'Content Creation with Human Review',
      description: 'Generate content, request human feedback, and refine',
      initial_state: {
        requirements: null,
        draft: null,
        feedback: null,
        revision: null,
        final_content: null,
        ui_components: [],
      },
      nodes: [
        'requirement_analysis',
        'content_generation',
        'human_review',
        'content_revision',
        'finalization',
        'completion'
      ],
      edges: [
        ['requirement_analysis', 'content_generation'],
        ['content_generation', 'human_review'],
        ['human_review', 'content_revision'],
        ['content_revision', 'finalization'],
        ['finalization', 'completion']
      ],
      interrupt_before: ['human_review'],
      interrupt_after: ['content_generation']
    });
  }

  async createWorkflow(templateId, inputData, sessionId) {
    const template = this.workflowTemplates.get(templateId);
    if (!template) {
      throw new Error(`Unknown workflow template: ${templateId}`);
    }

    const workflowId = uuidv4();
    const state = {
      ...template.initial_state,
      ...inputData,
      workflow_id: workflowId,
      session_id: sessionId,
      template_id: templateId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Create workflow graph
    const graph = this.createWorkflowGraph(template, state);

    // Store workflow
    this.activeWorkflows.set(workflowId, {
      graph,
      state,
      template,
      sessionId,
      createdAt: new Date(),
      status: 'created'
    });

    // Save to database
    await this.dbService.createWorkflow({
      id: workflowId,
      template_id: templateId,
      session_id: sessionId,
      state,
      status: 'created',
      created_at: state.created_at,
    });

    return workflowId;
  }

  createWorkflowGraph(template, initialState) {
    const graph = new StateGraph({
      input: () => initialState,
      output: (state) => state,
    });

    // Add nodes based on template
    for (const nodeName of template.nodes) {
      graph.addNode(nodeName, this.createNodeFunction(nodeName, template));
    }

    // Add edges
    for (const [from, to] of template.edges) {
      graph.addEdge(from, to);
    }

    // Set entry and end points
    graph.setEntryPoint(template.nodes[0]);
    graph.setFinishPoint(template.nodes[template.nodes.length - 1]);

    // Configure interrupts
    if (template.interrupt_before) {
      for (const nodeName of template.interrupt_before) {
        graph.addInterrupt(nodeName);
      }
    }

    return graph.compile();
  }

  createNodeFunction(nodeName, template) {
    return async (state) => {
      console.log(`Executing node: ${nodeName} for workflow: ${state.workflow_id}`);

      try {
        let newState = { ...state };
        newState.updated_at = new Date().toISOString();

        switch (nodeName) {
          case 'data_ingestion':
            newState = await this.handleDataIngestion(newState);
            break;
          case 'initial_analysis':
            newState = await this.handleInitialAnalysis(newState);
            break;
          case 'generate_insights':
            newState = await this.handleGenerateInsights(newState);
            break;
          case 'human_approval':
            newState = await this.handleHumanApproval(newState);
            break;
          case 'final_processing':
            newState = await this.handleFinalProcessing(newState);
            break;
          case 'context_analysis':
            newState = await this.handleContextAnalysis(newState);
            break;
          case 'option_generation':
            newState = await this.handleOptionGeneration(newState);
            break;
          case 'human_selection':
            newState = await this.handleHumanSelection(newState);
            break;
          case 'reasoning_generation':
            newState = await this.handleReasoningGeneration(newState);
            break;
          case 'confidence_assessment':
            newState = await this.handleConfidenceAssessment(newState);
            break;
          case 'requirement_analysis':
            newState = await this.handleRequirementAnalysis(newState);
            break;
          case 'content_generation':
            newState = await this.handleContentGeneration(newState);
            break;
          case 'human_review':
            newState = await this.handleHumanReview(newState);
            break;
          case 'content_revision':
            newState = await this.handleContentRevision(newState);
            break;
          case 'finalization':
            newState = await this.handleFinalization(newState);
            break;
          case 'completion':
            newState = await this.handleCompletion(newState);
            break;
        }

        // Send AG-UI events for UI updates
        await this.sendUIUpdateEvent(newState, nodeName);

        return newState;
      } catch (error) {
        console.error(`Error in node ${nodeName}:`, error);
        throw new Error(`Node ${nodeName} failed: ${error.message}`);
      }
    };
  }

  async executeWorkflow(workflowId) {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    workflow.status = 'running';
    await this.dbService.updateWorkflowStatus(workflowId, 'running');

    try {
      const result = await workflow.graph.invoke(workflow.state);

      // Update workflow with result
      workflow.state = result;
      workflow.status = 'completed';
      workflow.completedAt = new Date();

      await this.dbService.updateWorkflow(workflowId, {
        state: result,
        status: 'completed',
        completed_at: workflow.completedAt,
      });

      return result;
    } catch (error) {
      if (error.message.includes('interrupt')) {
        // Workflow paused for human interaction
        workflow.status = 'paused';
        await this.dbService.updateWorkflowStatus(workflowId, 'paused');

        // Store in paused workflows for resumption
        this.pausedWorkflows.set(workflowId, workflow);

        throw new Error('Workflow paused for human interaction');
      } else {
        // Actual error
        workflow.status = 'failed';
        workflow.error = error.message;

        await this.dbService.updateWorkflow(workflowId, {
          status: 'failed',
          error: error.message,
        });

        throw error;
      }
    }
  }

  async resumeWorkflow(workflowId, humanInput) {
    const workflow = this.pausedWorkflows.get(workflowId) || this.activeWorkflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    // Update state with human input
    workflow.state = {
      ...workflow.state,
      ...humanInput,
      updated_at: new Date().toISOString(),
    };

    // Move from paused to active if needed
    if (this.pausedWorkflows.has(workflowId)) {
      this.pausedWorkflows.delete(workflowId);
      this.activeWorkflows.set(workflowId, workflow);
    }

    workflow.status = 'resumed';
    await this.dbService.updateWorkflow(workflowId, {
      state: workflow.state,
      status: 'running',
    });

    // Continue execution
    return await this.executeWorkflow(workflowId);
  }

  async getWorkflowStatus(workflowId) {
    const workflow = this.activeWorkflows.get(workflowId) ||
                    this.pausedWorkflows.get(workflowId);

    if (!workflow) {
      // Try to get from database
      const dbWorkflow = await this.dbService.getWorkflow(workflowId);
      if (!dbWorkflow) {
        throw new Error(`Workflow not found: ${workflowId}`);
      }
      return dbWorkflow;
    }

    return {
      id: workflowId,
      template_id: workflow.template.id,
      session_id: workflow.sessionId,
      status: workflow.status,
      state: workflow.state,
      created_at: workflow.createdAt,
      completed_at: workflow.completedAt,
      error: workflow.error,
    };
  }

  // Node handlers for different workflow types
  async handleDataIngestion(state) {
    // Simulate data ingestion
    const processedData = Array.isArray(state.data) ? state.data : [state.data];

    return {
      ...state,
      processed_data: processedData,
      data_summary: `Processed ${processedData.length} data items`,
    };
  }

  async handleInitialAnalysis(state) {
    // Simulate initial data analysis
    const analysis = {
      summary: 'Initial analysis complete',
      key_metrics: {
        count: state.processed_data?.length || 0,
        quality_score: 0.85,
        completeness: 0.92,
      },
      recommendations: ['Proceed with deeper analysis', 'Consider additional data sources'],
    };

    return {
      ...state,
      analysis,
    };
  }

  async handleGenerateInsights(state) {
    // Generate insights and create UI for human review
    const insights = {
      patterns: ['Trend A increasing', 'Pattern B detected', 'Anomaly C identified'],
      predictions: ['Value X expected to rise', 'Risk Y identified'],
      recommendations: ['Action 1 recommended', 'Consider Strategy 2'],
    };

    // Generate UI components for insights display
    const uiComponents = await this.uiGenerator.generateInsightsDashboard(insights, state);

    return {
      ...state,
      insights,
      ui_components: uiComponents,
    };
  }

  async handleHumanApproval(state) {
    // This is an interrupt point - wait for human input
    if (!state.human_feedback) {
      throw new Error('Workflow interrupted: Waiting for human approval');
    }

    return {
      ...state,
      approval: state.human_feedback.approved,
      human_notes: state.human_feedback.notes,
    };
  }

  async handleFinalProcessing(state) {
    // Apply human feedback and finalize
    const finalResult = {
      ...state.insights,
      human_approved: state.approval,
      human_notes: state.human_notes,
      processed_at: new Date().toISOString(),
    };

    return {
      ...state,
      final_result: finalResult,
    };
  }

  async handleCompletion(state) {
    // Workflow completed successfully
    return {
      ...state,
      completed_at: new Date().toISOString(),
      status: 'completed',
    };
  }

  // Additional node handlers for other workflow types...
  async handleContextAnalysis(state) {
    return {
      ...state,
      analyzed_context: `Analyzed context: ${JSON.stringify(state.context)}`,
    };
  }

  async handleOptionGeneration(state) {
    const options = [
      { id: 1, name: 'Option A', description: 'Description of Option A' },
      { id: 2, name: 'Option B', description: 'Description of Option B' },
      { id: 3, name: 'Option C', description: 'Description of Option C' },
    ];

    return {
      ...state,
      options,
    };
  }

  async handleHumanSelection(state) {
    if (!state.human_choice) {
      throw new Error('Workflow interrupted: Waiting for human selection');
    }

    return {
      ...state,
      selected_option: state.human_choice,
    };
  }

  async handleReasoningGeneration(state) {
    const reasoning = `Selected ${state.selected_option.name} because: ${state.human_choice.reasoning || 'User provided reasoning'}`;

    return {
      ...state,
      reasoning,
    };
  }

  async handleConfidenceAssessment(state) {
    const confidence = Math.random() * 0.3 + 0.7; // 0.7-1.0

    return {
      ...state,
      confidence,
    };
  }

  async handleRequirementAnalysis(state) {
    return {
      ...state,
      analyzed_requirements: `Analyzed requirements: ${JSON.stringify(state.requirements)}`,
    };
  }

  async handleContentGeneration(state) {
    const draft = {
      title: 'Generated Content',
      content: 'This is the generated content based on requirements...',
      metadata: {
        word_count: 150,
        readability_score: 0.8,
        tone: 'professional',
      },
    };

    return {
      ...state,
      draft,
    };
  }

  async handleHumanReview(state) {
    if (!state.feedback) {
      throw new Error('Workflow interrupted: Waiting for human review');
    }

    return {
      ...state,
      review_feedback: state.feedback,
    };
  }

  async handleContentRevision(state) {
    const revision = {
      ...state.draft,
      content: `Revised content based on feedback: ${state.review_feedback.suggestions}`,
      revision_count: (state.draft.revision_count || 0) + 1,
    };

    return {
      ...state,
      revision,
    };
  }

  async handleFinalization(state) {
    const finalContent = {
      ...state.revision,
      finalized_at: new Date().toISOString(),
      approval_status: state.review_feedback.approved ? 'approved' : 'needs_revision',
    };

    return {
      ...state,
      final_content: finalContent,
    };
  }

  async sendUIUpdateEvent(state, nodeName) {
    if (state.ui_components && state.ui_components.length > 0) {
      await this.aguiService.sendEvent(state.session_id, {
        type: 'ui_update',
        event_id: uuidv4(),
        workflow_id: state.workflow_id,
        node: nodeName,
        timestamp: new Date().toISOString(),
        data: {
          components: state.ui_components,
          workflow_state: state,
        },
      });
    }
  }

  async getAvailableTemplates() {
    return Array.from(this.workflowTemplates.entries()).map(([id, template]) => ({
      id,
      name: template.name,
      description: template.description,
      nodes: template.nodes,
      interrupt_points: {
        before: template.interrupt_before || [],
        after: template.interrupt_after || [],
      },
    }));
  }
}

export { WorkflowOrchestrator };