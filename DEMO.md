# GUI-LOP Live Demo

## Server Status

The GUI-LOP server is running at **http://localhost:3001** with the following endpoints available:

### API Endpoints

#### Health Check
```bash
curl http://localhost:3001/health
```
**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-26T12:00:00.000Z",
  "message": "GUI-LOP Server with Authentication is running",
  "version": "1.0.0",
  "features": {
    "authentication": true,
    "websockets": true,
    "rateLimiting": true,
    "secureHeaders": true
  }
}
```

#### Workflow Templates
```bash
curl http://localhost:3001/api/workflows/templates
```
**Returns 3 workflow templates:**
1. Data Analysis Workflow
2. Decision Making Workflow
3. Content Creation Workflow

#### Create Workflow
```bash
curl -X POST http://localhost:3001/api/workflows \
  -H "Content-Type: application/json" \
  -d '{"template": "data-analysis", "context": {"task": "Analyze Q3 sales"}}'
```
**Returns:** Workflow ID for execution

#### Execute Workflow
```bash
curl -X POST http://localhost:3001/api/workflows/{workflow-id}/execute
```
**Action:** Simulates agent-generated UI creation and human collaboration

#### WebSocket Connection
```bash
# Connect to: ws://localhost:3001
# Real-time events for UI generation and workflow updates
```

## Available Features

### Server Infrastructure
- Express server with security middleware
- WebSocket support for real-time communication
- RESTful APIs for workflow management
- Health monitoring and logging

### Workflow Engine
- 3 HITL workflow templates
- Workflow creation and execution
- Status tracking and session management
- Human response collection

### API Endpoints
- `/health` - Server health check
- `/api/workflows/templates` - Available workflows
- `/api/workflows` - Create new workflow
- `/api/workflows/:id/execute` - Execute workflow
- `/api/workflows/:id/respond` - Human input handling
- WebSocket endpoint for real-time events

## Demo Workflow: Data Analysis

### Step 1: Create Workflow
```bash
curl -X POST http://localhost:3001/api/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "template": "data-analysis",
    "context": {"task": "Analyze customer churn data Q3 2024"}
  }'
```

### Step 2: Execute Workflow
```bash
curl -X POST http://localhost:3001/api/workflows/{id}/execute
```

### Step 3: UI Generation
- System simulates UI generation at `http://localhost:8501/{id}`
- WebSocket event sent: `{"type": "ui_generation", "ui_url": "...", "components": ["dashboard", "approval_form"]}`
- Workflow pauses for human collaboration

### Step 4: Human Response
```bash
curl -X POST http://localhost:3001/api/workflows/{id}/respond \
  -H "Content-Type: application/json" \
  -d '{
    "action": "approve",
    "data": {"insights": ["Insight 1", "Insight 2"], "recommendations": ["Rec 1"]}
  }'
```

### Step 5: Workflow Completion
- Agent receives human input
- Final report generated
- WebSocket event: `{"type": "workflow_completed", "result": {...}}`

## Try It Yourself

The server is running. Open a terminal and test:

```bash
# Check server health
curl http://localhost:3001/health

# List available workflow templates
curl http://localhost:3001/api/workflows/templates | jq '.'

# Create your own workflow
curl -X POST http://localhost:3001/api/workflows \
  -H "Content-Type: application/json" \
  -d '{"template": "decision-making", "context": {"decision": "Choose marketing strategy"}}'

# Connect via WebSocket for real-time events
# Use browser console:
# const ws = new WebSocket('ws://localhost:3001');
# ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

## WebSocket Events

### Connection Events
- `connected` - Initial connection established
- `echo` - Message echo functionality

### Workflow Events
- `ui_generation` - UI generated notification
- `workflow_completed` - Workflow completion notification

### Event Structure
```javascript
{
  "type": "event_type",
  "workflow_id": "uuid",
  "userId": "user_id",
  "payload": {
    // Event-specific data
  }
}
```

## Run Automated Demo

For a comprehensive demonstration:
```bash
./demo.sh
```

This script will:
- Check dependencies
- Run backend tests
- Start the server
- Test all API endpoints
- Demonstrate workflow creation and execution
- Test WebSocket communication
- Generate performance report