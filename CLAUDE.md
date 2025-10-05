# Claude Code Configuration - GUI-LOP Development Environment

## 🚨 CRITICAL: CONCURRENT EXECUTION & FILE MANAGEMENT

**ABSOLUTE RULES**:
1. ALL operations MUST be concurrent/parallel in a single message
2. **NEVER save working files, text/mds and tests to the root folder**
3. ALWAYS organize files in appropriate subdirectories
4. **USE CLAUDE CODE'S TASK TOOL** for spawning agents concurrently, not just MCP

### ⚡ GOLDEN RULE: "1 MESSAGE = ALL RELATED OPERATIONS"

**MANDATORY PATTERNS:**
- **TodoWrite**: ALWAYS batch ALL todos in ONE call (5-10+ todos minimum)
- **Task tool (Claude Code)**: ALWAYS spawn ALL agents in ONE message with full instructions
- **File operations**: ALWAYS batch ALL reads/writes/edits in ONE message
- **Bash commands**: ALWAYS batch ALL terminal operations in ONE message
- **Memory operations**: ALWAYS batch ALL memory store/retrieve in ONE message

### 🎯 CRITICAL: Claude Code Task Tool for Agent Execution

**Claude Code's Task tool is the PRIMARY way to spawn agents:**
```javascript
// ✅ CORRECT: Use Claude Code's Task tool for parallel agent execution
[Single Message]:
  Task("Research agent", "Analyze requirements and patterns...", "researcher")
  Task("Coder agent", "Implement core features...", "coder")
  Task("Tester agent", "Create comprehensive tests...", "tester")
  Task("Reviewer agent", "Review code quality...", "reviewer")
  Task("Architect agent", "Design system architecture...", "system-architect")
```

**MCP tools are ONLY for coordination setup:**
- `mcp__claude-flow__swarm_init` - Initialize coordination topology
- `mcp__claude-flow__agent_spawn` - Define agent types for coordination
- `mcp__claude-flow__task_orchestrate` - Orchestrate high-level workflows

### 📁 File Organization Rules

**NEVER save to root folder. Use these directories:**
- `/src` - Source code files
- `/tests` - Test files
- `/docs` - Documentation and markdown files
- `/config` - Configuration files
- `/scripts` - Utility scripts
- `/examples` - Example code

## 🎯 Project Overview: GUI-LOP

### Project Type
- **Category**: custom
- **Type**: Generative UI & Human-in-the-Loop Orchestration Platform
- **Frontend**: React + Streamlit/Gradio for dynamic UI generation
- **Backend**: Node.js/Express + LangGraph for orchestration
- **Database**: PostgreSQL
- **Methodology**: SPARC
- **Features**: All features including HITL workflows, UI generation, and agent orchestration

### Vision
GUI-LOP inverts the current paradigm: instead of humans using static UIs to interact with agents, GUI-LOP enables agents to dynamically generate their own user interfaces for richer collaboration with human partners.

## 🏗️ Architecture & Core Components

### 1. Orchestration & HITL Core (LangGraph)
- **Purpose**: Robust Human-in-the-Loop workflow management
- **Key Features**:
  - State graph with `interrupt_before`/`interrupt_after` flags
  - Collaborative checkpoints at critical junctures
  - Pause and resume execution workflows

### 2. Agent-UI Communication Protocol (AG-UI)
- **Purpose**: Standardized communication between agent backend and dynamic frontend
- **Implementation**: Event-driven protocol with standardized payloads
- **Events**: `tool_input_request`, `ui_update`, `approval_request`, `data_display`

### 3. UI Generation Engine
- **Technologies**: Streamlit and Gradio for rapid UI generation
- **Capabilities**:
  - `ui_tool.display_interactive_dashboard(data, title)`
  - `ui_tool.request_approval(message, options)`
  - `ui_tool.show_options_and_get_choice(prompt, options)`
  - Dynamic script generation and execution

### 4. React Frontend Shell
- **Purpose**: Host container for dynamically generated UIs
- **Features**:
  - AG-UI event handling
  - Iframe/container for Streamlit/Gradio apps
  - Real-time communication with backend

## 🔄 SPARC Development Workflow

### SPARC Commands
- `npx claude-flow sparc modes` - List available modes
- `npx claude-flow sparc run <mode> "<task>"` - Execute specific mode
- `npx claude-flow sparc tdd "<feature>"` - Run complete TDD workflow
- `npx claude-flow sparc info <mode>` - Get mode details

### SPARC Workflow Phases
1. **Specification** - Requirements analysis (`sparc run spec-pseudocode`)
   - Define HITL workflow requirements
   - Specify UI generation needs
   - Document AG-UI protocol events
2. **Pseudocode** - Algorithm design (`sparc run spec-pseudocode`)
   - Design LangGraph state machines
   - Plan UI generation logic
   - Define interaction patterns
3. **Architecture** - System design (`sparc run architect`)
   - Design React frontend structure
   - Plan Express API endpoints
   - Design PostgreSQL schema
   - Define AG-UI protocol specifications
4. **Refinement** - TDD implementation (`sparc tdd`)
   - Implement LangGraph workflows
   - Build UI generation tools
   - Create React components
   - Develop Express APIs
5. **Completion** - Integration (`sparc run integration`)
   - End-to-end HITL workflows
   - Performance optimization
   - Documentation and deployment

## 🛠️ Technology Stack Implementation

### Frontend (React)
```javascript
// Core React components structure
/src/frontend/
├── components/
│   ├── UIContainer.jsx      // Host for dynamic UIs
│   ├── EventHandlers.jsx    // AG-UI protocol handlers
│   └── WorkflowManager.jsx  // HITL workflow state
├── services/
│   ├── api.js              // Backend communication
│   └── events.js           // AG-UI event handling
└── App.jsx                 // Main application
```

### Backend (Node.js/Express + LangGraph)
```javascript
// Backend architecture
/src/backend/
├── agents/
│   ├── orchestration.js    // LangGraph workflows
│   └── ui-generator.js     // UI generation tools
├── routes/
│   ├── events.js          // AG-UI event endpoints
│   └── workflows.js       // HITL workflow APIs
├── services/
│   └── agui-protocol.js   // AG-UI protocol implementation
└── server.js              // Express server
```

### Database (PostgreSQL)
```sql
-- Core tables for GUI-LOP
workflow_sessions          -- HITL workflow state
ui_instances              -- Generated UI instances
agui_events               -- AG-UI event log
user_interactions         -- Human interaction history
```

## 🤖 Available Agents & Specializations

### Core Development (54 Total)
`coder`, `reviewer`, `tester`, `planner`, `researcher`

### GUI-LOP Specialized Agents
- `ui-generation-agent` - Streamlit/Gradio UI generation
- `hitl-coordinator` - Human-in-the-Loop workflow management
- `agui-protocol-agent` - AG-UI protocol implementation
- `langgraph-orchestrator` - LangGraph state machine management
- `react-frontend-developer` - React UI development
- `express-api-developer` - Express backend development
- `postgresql-architect` - Database design and optimization

### Swarm Coordination
`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`, `collective-intelligence-coordinator`, `swarm-memory-manager`

### Performance & Optimization
`perf-analyzer`, `performance-benchmarker`, `task-orchestrator`, `memory-coordinator`, `smart-agent`

## 🚀 Agent Execution Patterns for GUI-LOP

### Example: Building HITL Workflow
```javascript
// Single message with all agent spawning via Claude Code's Task tool
[Parallel Agent Execution]:
  Task("UI Generation Agent", "Create Streamlit script for data visualization dashboard", "ui-generation-agent")
  Task("LangGraph Orchestrator", "Design HITL workflow with interrupt points", "langgraph-orchestrator")
  Task("React Frontend Developer", "Build UI container component for dynamic apps", "react-frontend-developer")
  Task("Express API Developer", "Implement AG-UI protocol endpoints", "express-api-developer")
  Task("PostgreSQL Architect", "Design schema for workflow sessions", "postgresql-architect")
  Task("HITL Coordinator", "Define human approval workflow patterns", "hitl-coordinator")

  // All todos batched together
  TodoWrite { todos: [
    {id: "1", content: "Design LangGraph state machine with HITL checkpoints", status: "in_progress", priority: "high"},
    {id: "2", content: "Create AG-UI protocol event specifications", status: "in_progress", priority: "high"},
    {id: "3", content: "Implement UI generation tools (Streamlit/Gradio)", status: "pending", priority: "high"},
    {id: "4", content: "Build React frontend container", status: "pending", priority: "high"},
    {id: "5", content: "Develop Express API endpoints", status: "pending", priority: "medium"},
    {id: "6", content: "Design PostgreSQL schema", status: "pending", priority: "medium"},
    {id: "7", content: "Implement end-to-end HITL workflow", status: "pending", priority: "medium"},
    {id: "8", content: "Test dynamic UI generation", status: "pending", priority: "low"}
  ]}

  // Parallel file operations
  Write "src/backend/agents/orchestration.js"
  Write "src/backend/agents/ui-generator.js"
  Write "src/frontend/components/UIContainer.jsx"
  Write "src/backend/routes/events.js"
  Write "config/database.sql"
```

## 📋 Agent Coordination Protocol

### Every Agent Spawned via Task Tool MUST:

**1️⃣ BEFORE Work:**
```bash
npx claude-flow@alpha hooks pre-task --description "[task]"
npx claude-flow@alpha hooks session-restore --session-id "swarm-[id]"
```

**2️⃣ DURING Work:**
```bash
npx claude-flow@alpha hooks post-edit --file "[file]" --memory-key "swarm/[agent]/[step]"
npx claude-flow@alpha hooks notify --message "[what was done]"
```

**3️⃣ AFTER Work:**
```bash
npx claude-flow@alpha hooks post-task --task-id "[task]"
npx claude-flow@alpha hooks session-end --export-metrics true
```

## 🎯 GUI-LOP Development Workflow Examples

### Collaborative Data Analysis Workflow
```javascript
// Example: Building a data analysis HITL workflow
[Single Message - Complete Feature Development]:
  Task("Orchestrator", "Design LangGraph workflow: Analyze data → Generate insights → Request human approval", "langgraph-orchestrator")
  Task("UI Generator", "Create Streamlit dashboard for data visualization and approval interface", "ui-generation-agent")
  Task("Frontend Developer", "Build React container to host dynamic data dashboard", "react-frontend-developer")
  Task("Backend Developer", "Implement AG-UI events for data updates and approval flow", "express-api-developer")
  Task("Database Architect", "Design schema for data sessions and user interactions", "postgresql-architect")
  Task("Tester", "Write end-to-end tests for complete HITL data analysis workflow", "tester")

  // Complete feature implementation
  Write "src/backend/workflows/data-analysis.js"
  Write "src/backend/agents/data-dashboard-generator.js"
  Write "src/frontend/components/DataAnalysisContainer.jsx"
  Write "src/backend/events/data-analysis-events.js"
  Write "tests/integration/data-analysis-workflow.test.js"
```

## 🔧 Code Style & Best Practices

### GUI-LOP Specific Guidelines
- **Modular UI Generation**: Each UI component as separate, reusable tool
- **Event-Driven Architecture**: All communication via AG-UI protocol events
- **State Management**: LangGraph handles workflow state, React handles UI state
- **HITL First**: Design workflows with human collaboration as primary consideration
- **Dynamic UI Patterns**: UIs generated based on context and data
- **Security**: Validate all human inputs and sanitize generated UI code

### General Best Practices
- **Modular Design**: Files under 500 lines
- **Environment Safety**: Never hardcode secrets
- **Test-First**: Write tests before implementation
- **Clean Architecture**: Separate concerns
- **Documentation**: Keep updated

## 🚀 Quick Setup for GUI-LOP

```bash
# Add MCP servers (Claude Flow required)
claude mcp add claude-flow npx claude-flow@alpha mcp start

# Initialize GUI-LOP project with SPARC methodology
npx claude-flow@alpha sparc init --project-type "gui-lop" --methodology "sparc"

# Setup development environment
npm install express react langchain streamlit gradio

# Initialize database
createdb gui-lop
psql gui-lop -f config/database.sql
```

## 📊 Performance & Quality Metrics

- **Target HITL Response Time**: < 2 seconds for UI generation
- **UI Generation Success Rate**: > 95%
- **End-to-End Workflow Success**: > 90%
- **Code Coverage**: > 85%
- **Agent Coordination Efficiency**: > 80%

## 🎯 Success Criteria for GUI-LOP

1. **Dynamic UI Generation**: Agents can generate appropriate UIs for any workflow step
2. **Seamless HITL Integration**: Human approval workflows are intuitive and reliable
3. **Protocol Standardization**: AG-UI protocol enables interoperability
4. **Performance**: UI generation and workflow execution are fast and responsive
5. **Developer Experience**: Easy to extend and customize for different use cases

## Integration Tips

1. **Start Simple**: Begin with basic UI generation tools
2. **Iterate on Workflows**: Refine HITL patterns based on user feedback
3. **Use Memory**: Store workflow context and UI patterns
4. **Monitor Performance**: Track UI generation success and timing
5. **Test Extensively**: Validate HITL workflows end-to-end
6. **Security First**: Sanitize all generated UI code and user inputs

## Support

- **Documentation**: https://github.com/ruvnet/claude-flow
- **Issues**: https://github.com/ruvnet/claude-flow/issues
- **GUI-LOP Project**: Internal documentation and examples

---

**GUI-LOP Motto**: "Agents don't chat with humans - they collaborate through dynamically generated interfaces"

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
Never save working files, text/mds and tests to the root folder.