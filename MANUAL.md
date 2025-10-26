# GUI-LOP Manual - Using and Extending the Platform

## Table of Contents
1. [Quick Start Guide](#quick-start-guide)
2. [Basic Usage](#basic-usage)
3. [Creating Custom Workflows](#creating-custom-workflows)
4. [Advanced Configuration](#advanced-configuration)
5. [Production Deployment](#production-deployment)
6. [Troubleshooting](#troubleshooting)

---

## Quick Start Guide

### Prerequisites
- Node.js 18.x or higher
- Modern web browser
- Basic understanding of REST APIs

### Installation
```bash
# Clone and install
git clone https://github.com/ruvnet/gui-lop.git
cd gui-lop
npm install
cd src/frontend && npm install && cd ../..

# Start both servers
npm run dev:full
# Backend: http://localhost:3001
# Frontend: http://localhost:3000
```

### Quick Test
```bash
# Run the automated demo
./demo.sh

# Manual test
curl http://localhost:3001/health
curl http://localhost:3001/api/workflows/templates
```

---

## Basic Usage

### 1. Using the Web Interface

1. **Open Browser**: Navigate to http://localhost:3000
2. **Check Status**: Look for green "Server: connected" indicator
3. **Start Workflow**: Click any workflow button (Data Analysis, Decision Making, Content Creation)
4. **Monitor Progress**: Watch the event log for real-time updates
5. **Provide Input**: When workflow waits for human input, click "Approve & Complete"

### 2. Using the API Directly

#### Check Server Health
```bash
curl http://localhost:3001/health
```

#### List Available Workflows
```bash
curl http://localhost:3001/api/workflows/templates | jq .
```

#### Create a Workflow
```bash
curl -X POST http://localhost:3001/api/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "template": "data-analysis",
    "context": {
      "task": "Analyze customer churn data",
      "dataSource": "churn_q3_2024.csv",
      "analysisType": "predictive"
    }
  }'
```

#### Execute Workflow
```bash
# Replace WORKFLOW_ID with actual ID from previous response
curl -X POST http://localhost:3001/api/workflows/WORKFLOW_ID/execute
```

#### Check Workflow Status
```bash
curl http://localhost:3001/api/workflows/WORKFLOW_ID
```

#### Provide Human Response
```bash
curl -X POST http://localhost:3001/api/workflows/WORKFLOW_ID/respond \
  -H "Content-Type: application/json" \
  -d '{
    "action": "approve",
    "data": {
      "insights": ["Customer retention decreased by 15%"],
      "recommendations": ["Launch retention campaign"],
      "confidence": 0.85
    }
  }'
```

### 3. WebSocket Connection

```javascript
// Connect to WebSocket server
const ws = new WebSocket('ws://localhost:3001');

ws.onopen = () => {
  console.log('Connected to GUI-LOP');
  ws.send(JSON.stringify({type: 'test', message: 'Hello'}));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Event:', data.type);

  // Handle different event types
  switch(data.type) {
    case 'connected':
      console.log('Server acknowledged connection');
      break;
    case 'workflow_completed':
      console.log('Workflow finished:', data.payload);
      break;
    case 'ui_generation':
      console.log('UI ready:', data.payload.ui_url);
      break;
  }
};
```

---

## Creating Custom Workflows

### 1. Understanding Workflow Structure

Every workflow has this structure:
```json
{
  "id": "unique-workflow-id",
  "template": "template-name",
  "status": "created|executing|waiting_for_human|completed",
  "context": {...},
  "created_at": "2024-01-01T12:00:00.000Z",
  "human_response": null
}
```

### 2. Adding a New Workflow Template

#### Step 1: Update Server Template List
Edit `src/backend/simple-server.js` and add to the templates array in the `/api/workflows/templates` endpoint:

```javascript
{
  id: "contract-review",
  name: "Contract Review Workflow",
  description: "AI analyzes legal contracts and human lawyer reviews critical clauses",
  steps: [
    "Contract Ingestion",
    "Clause Analysis",
    "Risk Assessment",
    "Human Legal Review",
    "Final Recommendations"
  ],
  category: "legal",
  requiresAuth: true,
  complexity: "advanced"
}
```

#### Step 2: Test Your New Workflow
```bash
curl -X POST http://localhost:3001/api/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "template": "contract-review",
    "context": {
      "contractType": "service_agreement",
      "jurisdiction": "California",
      "riskTolerance": "medium"
    }
  }'
```

### 3. Workflow Template Examples

#### A. IT Security Audit Workflow
```javascript
{
  id: "security-audit",
  name: "Security Audit Workflow",
  description: "Automated security analysis with human expert validation",
  steps: [
    "System Scanning",
    "Vulnerability Detection",
    "Risk Assessment",
    "Security Expert Review",
    "Remediation Plan"
  ],
  category: "security",
  requiresAuth: true,
  complexity: "advanced"
}
```

#### B. Product Launch Review Workflow
```javascript
{
  id: "product-launch",
  name: "Product Launch Review",
  description: "AI evaluates launch readiness, human stakeholders approve",
  steps: [
    "Market Analysis Review",
    "Compliance Check",
    "Financial Projections",
    "Stakeholder Approval",
    "Launch Decision"
  ],
  category: "business",
  requiresAuth: true,
  complexity: "intermediate"
}
```

---

## Advanced Configuration

### 1. Environment Variables

Create a `.env` file for production configuration:
```bash
# Server Configuration
PORT=3001
NODE_ENV=production

# Database (when implemented)
DATABASE_URL=postgresql://user:pass@localhost:5432/gui-lop

# Security
CORS_ORIGIN=https://yourdomain.com
JWT_SECRET=your-secret-key

# WebSocket Configuration
WS_HEARTBEAT_INTERVAL=30000
WS_MAX_CONNECTIONS=1000

# Workflow Settings
MAX_CONCURRENT_WORKFLOWS=50
WORKFLOW_TIMEOUT=3600000
DEFAULT_LANGUAGE=en
```

### 2. Security Enhancements

#### Rate Limiting
```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});

app.use('/api/', limiter);
```

---

## Production Deployment

### 1. Docker Deployment

#### Dockerfile
```dockerfile
# Backend Dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY src/backend ./src/backend
EXPOSE 3001

CMD ["node", "src/backend/simple-server.js"]
```

#### docker-compose.yml
```yaml
version: '3.8'
services:
  backend:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@db:5432/gui-lop
    depends_on:
      - db

  db:
    image: postgres:14
    environment:
      - POSTGRES_DB=gui-lop
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### 2. Monitoring and Logging

#### Health Check Endpoints
```javascript
// Add detailed health check
app.get('/health/detailed', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    activeWorkflows: workflows.size,
    websocketConnections: clients.size
  };

  res.json(health);
});
```

---

## Troubleshooting

### 1. Common Issues

#### Server Won't Start
```bash
# Check if port is in use
lsof -ti:3001
kill -9 <PID>

# Check Node.js version
node --version  # Should be 18.x or higher

# Check dependencies
npm ls
npm install  # Fix missing dependencies
```

#### Frontend Not Connecting to Backend
```bash
# Check backend is running
curl http://localhost:3001/health

# Check CORS configuration
# Ensure backend allows requests from frontend origin
```

#### Workflows Not Executing
```bash
# Check server logs
npm run dev  # Look for console output

# Verify workflow template exists
curl http://localhost:3001/api/workflows/templates

# Check WebSocket connection
# Open browser console and look for WebSocket errors
```

### 2. Debug Mode

```bash
# Enable verbose logging
DEBUG=gui-lop:* npm run dev

# Test with specific port
PORT=3999 npm run dev

# Run in production mode locally
NODE_ENV=production npm start
```

### 3. Health Checks

```bash
# Backend health
curl http://localhost:3001/health

# WebSocket connectivity
npx wscat -c ws://localhost:3001

# API endpoints availability
curl http://localhost:3001/api/workflows/templates

# Frontend accessibility (if running)
curl http://localhost:3000
```

---

## Getting Help

### 1. Development Best Practices
- Always test custom workflows before production
- Use environment variables for configuration
- Implement proper error handling for all API calls
- Add logging for debugging production issues
- Monitor performance and memory usage

### 2. Production Checklist
- [ ] Set up proper authentication and authorization
- [ ] Configure HTTPS and security headers
- [ ] Set up monitoring and alerting
- [ ] Implement backup and recovery procedures
- [ ] Test with realistic load
- [ ] Document custom workflows and integrations
- [ ] Train users on the new workflow processes

**Remember**: GUI-LOP is a foundation. The real value comes from adapting it to solve specific business problems in your organization.