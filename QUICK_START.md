# GUI-LOP Quick Start Guide

## 🚀 Quick Start

**GUI-LOP** enables agents to dynamically generate user interfaces for richer human collaboration. Get started in minutes!

### Prerequisites

- **Node.js** 18.x or higher
- **PostgreSQL** 13+ (optional for full features)
- **Git** for cloning

### 1️⃣ Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd GUI-LOP

# Install dependencies
npm install

# Setup environment (optional)
cp .env.example .env
# Edit .env with your configuration
```

### 2️⃣ Quick Launch

```bash
# Start the development server
npm run dev

# Or start production server
npm start
```

The server will be available at **http://localhost:3000**

### 3️⃣ Verify Installation

```bash
# Health check
curl http://localhost:3000/health

# Expected response:
# {"status": "ok", "timestamp": "2025-10-05T06:45:00.000Z"}
```

### 4️⃣ Try a Simple Workflow

```bash
# Create a new HITL workflow
curl -X POST http://localhost:3000/api/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "template": "data-analysis",
    "context": {
      "task": "Analyze sales data Q3 2024"
    }
  }'

# Execute the workflow
curl -X POST http://localhost:3000/api/workflows/{workflow-id}/execute
```

### 5️⃣ Access Dynamic UI

Open **http://localhost:3000** in your browser to see the React frontend shell. The system will:

1. Display workflow status
2. Show dynamically generated UIs from agents
3. Enable human collaboration through interrupt points
4. Provide real-time updates via WebSocket

## 🎯 First Example: Data Analysis Workflow

### Step 1: Start the Workflow

```javascript
// Using fetch API
const response = await fetch('http://localhost:3000/api/workflows', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    template: 'data-analysis',
    context: {
      task: 'Analyze customer churn data',
      data: [/* your data here */]
    }
  })
});

const { workflow_id } = await response.json();
```

### Step 2: Execute and Monitor

```javascript
// Start execution
await fetch(`http://localhost:3000/api/workflows/${workflow_id}/execute`, {
  method: 'POST'
});

// Monitor via WebSocket
const ws = new WebSocket('ws://localhost:3000/ws');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Workflow update:', data);

  // Handle UI generation events
  if (data.type === 'ui_generation') {
    // Open the dynamically generated UI
    window.open(data.ui_url, '_blank');
  }
};
```

### Step 3: Human Collaboration

The system will pause at critical decision points and:

1. **Generate a Streamlit dashboard** with data visualization
2. **Request human approval** on analysis insights
3. **Collect feedback** through interactive forms
4. **Resume execution** based on human input

## 🔧 Development Commands

```bash
# Development
npm run dev          # Start development server with hot reload
npm run start:frontend # Start both backend and frontend

# Testing
npm run test         # Run all tests
npm run test:unit    # Unit tests only
npm run test:e2e     # End-to-end tests with Playwright
npm run test:coverage # Generate coverage report

# Quality
npm run lint         # ESLint
npm run typecheck    # TypeScript checking
npm run build        # Build for production
```

## 🌐 Key URLs

- **Frontend**: http://localhost:3000
- **API Docs**: http://localhost:3000/api/docs (if enabled)
- **Health Check**: http://localhost:3000/health
- **WebSocket**: ws://localhost:3000/ws

## 🎮 What You Can Do Right Now

### ✅ Available Features

1. **Dynamic UI Generation** - Agents create Streamlit/Gradio interfaces
2. **HITL Workflows** - Human-in-the-loop decision points
3. **Real-time Communication** - WebSocket-based updates
4. **Workflow Templates** - Data analysis, decision making, content creation
5. **AG-UI Protocol** - Standardized agent-UI communication

### 🎯 Try These Workflows

#### Data Analysis Workflow
```bash
curl -X POST http://localhost:3000/api/workflows \
  -H "Content-Type: application/json" \
  -d '{"template": "data-analysis", "context": {"task": "Analyze Q3 sales"}}'
```

#### Decision Making Workflow
```bash
curl -X POST http://localhost:3000/api/workflows \
  -H "Content-Type: application/json" \
  -d '{"template": "decision-making", "context": {"decision": "Choose marketing strategy"}}'
```

#### Content Creation Workflow
```bash
curl -X POST http://localhost:3000/api/workflows \
  -H "Content-Type: application/json" \
  -d '{"template": "content-creation", "context": {"content_type": "blog post"}}'
```

## 📱 Frontend Features

The React frontend provides:

- **Workflow Dashboard** - View active and completed workflows
- **Dynamic UI Container** - Hosts agent-generated interfaces
- **Real-time Updates** - Live status and progress tracking
- **Interactive Controls** - Human input collection and approval flows

## 🚨 Troubleshooting

### Server Won't Start
```bash
# Check port availability
lsof -ti:3000 | xargs kill -9

# Check logs
npm run dev 2>&1 | head -20
```

### Tests Failing
```bash
# Install Playwright browsers
npx playwright install

# Update dependencies
npm update
```

### Database Connection Issues
```bash
# Setup PostgreSQL (optional for basic usage)
createdb gui-lop
psql gui-lop -f config/database.sql
```

## 🎯 Next Steps

1. **Explore the Architecture** - Read `/docs/architecture/`
2. **Customize Workflows** - Modify templates in `/src/backend/agents/orchestration.js`
3. **Add UI Components** - Extend `/src/backend/services/ui-generation.js`
4. **Integrate Your Data** - Connect to your databases and APIs
5. **Deploy** - Use Docker or cloud deployment

## 📚 Learn More

- **Full Documentation**: `/docs/`
- **Architecture Guide**: `/docs/architecture/README.md`
- **API Reference**: `/docs/api/`
- **Examples**: `/examples/`

**GUI-LOP** is now running! Agents can generate dynamic interfaces and collaborate with humans through rich, interactive workflows.