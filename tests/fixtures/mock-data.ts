// Mock data fixtures for GUI-LOP testing

export const mockUsers = {
  validUser: {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
    createdAt: new Date('2024-01-01T00:00:00Z'),
  },
  adminUser: {
    id: 'admin-456',
    email: 'admin@example.com',
    name: 'Admin User',
    role: 'admin',
    createdAt: new Date('2024-01-01T00:00:00Z'),
  },
};

export const mockWorkflows = {
  dataAnalysis: {
    id: 'workflow-1',
    name: 'Data Analysis Workflow',
    type: 'data-analysis',
    status: 'active',
    steps: [
      { id: 'step-1', name: 'Load Data', type: 'data-loader' },
      { id: 'step-2', name: 'Analyze Data', type: 'analysis' },
      { id: 'step-3', name: 'Generate Dashboard', type: 'ui-generation' },
    ],
  },
  hitlApproval: {
    id: 'workflow-2',
    name: 'HITL Approval Workflow',
    type: 'hitl-approval',
    status: 'pending_approval',
    steps: [
      { id: 'step-1', name: 'Generate Proposal', type: 'generation' },
      { id: 'step-2', name: 'Request Approval', type: 'human-approval' },
      { id: 'step-3', name: 'Execute Approved Action', type: 'execution' },
    ],
  },
};

export const mockAGUIEvents = {
  toolInputRequest: {
    type: 'tool_input_request',
    payload: {
      requestId: 'req-123',
      toolName: 'data_visualizer',
      parameters: {
        dataType: 'sales_data',
        visualizationType: 'dashboard',
      },
    },
    timestamp: Date.now(),
  },
  uiUpdate: {
    type: 'ui_update',
    payload: {
      componentId: 'dashboard-456',
      updateType: 'data_refresh',
      data: {
        metrics: { revenue: 10000, users: 500 },
        charts: [{ type: 'bar', data: [1, 2, 3, 4, 5] }],
      },
    },
    timestamp: Date.now(),
  },
  approvalRequest: {
    type: 'approval_request',
    payload: {
      workflowId: 'workflow-2',
      stepId: 'step-2',
      message: 'Please approve the proposed data analysis configuration',
      options: ['approve', 'reject', 'modify'],
      timeout: 300000,
    },
    timestamp: Date.now(),
  },
};

export const mockUIGeneration = {
  streamlitDashboard: {
    type: 'streamlit',
    code: `
import streamlit as st
import pandas as pd

st.title("Sales Dashboard")
data = pd.DataFrame({
  'Month': ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
  'Sales': [1000, 1200, 900, 1500, 1800]
})

st.line_chart(data.set_index('Month'))
st.write("Total Sales: $", data['Sales'].sum())
    `,
    expectedRenderTime: 1500,
  },
  gradioInterface: {
    type: 'gradio',
    code: `
import gradio as gr

def analyze_data(data_input):
    return f"Analyzed: {data_input}"

iface = gr.Interface(
    fn=analyze_data,
    inputs="text",
    outputs="text",
    title="Data Analysis Tool"
)

iface.launch()
    `,
    expectedRenderTime: 1200,
  },
};

export const mockDatabaseState = {
  workflowSessions: [
    {
      id: 'session-1',
      workflowId: 'workflow-1',
      userId: 'user-123',
      status: 'running',
      currentState: { step: 2, data: { processed: true } },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  uiInstances: [
    {
      id: 'ui-instance-1',
      sessionId: 'session-1',
      type: 'streamlit',
      config: mockUIGeneration.streamlitDashboard,
      status: 'active',
      createdAt: new Date(),
    },
  ],
  aguiEvents: [
    {
      id: 'event-1',
      sessionId: 'session-1',
      type: 'ui_update',
      payload: mockAGUIEvents.uiUpdate.payload,
      processed: true,
      createdAt: new Date(),
    },
  ],
};

export const performanceTestData = {
  uiGeneration: {
    smallUI: { expectedTime: 500, size: 'small' },
    mediumUI: { expectedTime: 1500, size: 'medium' },
    largeUI: { expectedTime: 3000, size: 'large' },
  },
  workflowExecution: {
    simpleWorkflow: { expectedTime: 2000, complexity: 'simple' },
    complexWorkflow: { expectedTime: 5000, complexity: 'complex' },
  },
  apiResponse: {
    getRequests: { expectedTime: 200, type: 'GET' },
    postRequests: { expectedTime: 500, type: 'POST' },
    complexQueries: { expectedTime: 1000, type: 'COMPLEX_QUERY' },
  },
};