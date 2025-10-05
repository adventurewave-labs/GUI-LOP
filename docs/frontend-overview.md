# GUI-LOP Frontend Overview

## Architecture Overview

The GUI-LOP frontend is built with React 18 and provides a sophisticated platform for hosting dynamically generated UIs from AI agents. The frontend implements the AG-UI protocol for real-time communication between agents and users.

## Core Components

### 1. UIContainer (`/src/frontend/components/UIContainer.jsx`)
**Purpose**: Host container for dynamically generated UIs (Streamlit/Gradio apps)

**Key Features**:
- Iframe-based hosting for isolated UI execution
- WebSocket integration for real-time communication
- Error handling and retry mechanisms
- Loading states and fallback UIs
- Event history tracking for debugging
- Support for multiple UI types (Streamlit, Gradio, Custom)

**AG-UI Events Handled**:
- `ui_update` - Refresh or update UI content
- `tool_input_request` - Request user input for tools
- `approval_request` - Human-in-the-loop approval workflows
- `data_display` - Display data visualizations

### 2. EventHandlers (`/src/frontend/components/EventHandlers.jsx`)
**Purpose**: Centralized event handling for AG-UI protocol

**Key Features**:
- Event registration and management
- Context-based state sharing
- Debug overlay for development
- Automatic cleanup of expired requests
- Support for pending approvals and tool inputs

**Collaboration Types**:
- Checkpoint approvals
- Tool input collection
- Data display management
- Workflow state synchronization

### 3. WorkflowManager (`/src/frontend/components/WorkflowManager.jsx`)
**Purpose**: HITL workflow state management and orchestration

**Key Features**:
- State machine for workflow lifecycle
- Checkpoint management
- Collaboration point handling
- Progress tracking and visualization
- History and audit trail
- Context-based hooks for component integration

**Workflow States**:
- `IDLE` - Ready for new workflows
- `INITIALIZING` - Setting up workflow
- `RUNNING` - Active execution
- `PAUSED` - Temporarily halted
- `WAITING_FOR_INPUT` - Awaiting user input
- `WAITING_FOR_APPROVAL` - Human approval required
- `COMPLETED` - Successfully finished
- `ERROR` - Failed execution
- `CANCELLED` - Manually stopped

## Services

### 1. API Service (`/src/frontend/services/api.js`)
**Purpose**: Backend communication layer

**Key Features**:
- HTTP request management with error handling
- Session management
- Workflow control APIs
- WebSocket connection management
- Event streaming capabilities
- Batch request support

**API Endpoints**:
- `/api/health` - Service health check
- `/api/sessions` - Session management
- `/api/sessions/:id/workflows` - Workflow operations
- `/api/sessions/:id/events` - AG-UI events
- `/api/sessions/:id/generate-ui` - Dynamic UI generation

### 2. AG-UI Event Service (`/src/frontend/services/events.js`)
**Purpose**: AG-UI protocol implementation

**Key Features**:
- Standardized event definitions
- Event validation and routing
- History tracking and filtering
- Performance monitoring
- Debugging utilities
- React hook integration

**Event Types**:
- Core protocol events (ui_update, tool_input_request, approval_request)
- Workflow control events (start, pause, resume, complete)
- Data exchange events (request, response, streaming)
- UI interaction events (form submits, selections, navigation)

## Application Structure

### Main App (`/src/frontend/App.jsx`)
**Purpose**: Orchestrates all components and services

**Key Features**:
- Session initialization
- Workflow coordination
- Error boundary management
- Debug mode support
- Responsive layout
- Accessibility compliance

### Entry Point (`/src/frontend/index.js`)
**Purpose**: Application bootstrap and React 18 setup

**Features**:
- React 18 concurrent rendering
- Hot module replacement (development)
- Service worker registration (production)
- Performance monitoring hooks

## Testing Strategy

### Playwright Test Coverage

**UIContainer Tests** (`/tests/frontend/ui-container.test.js`):
- Loading states and error handling
- iframe communication
- WebSocket event handling
- Different UI types
- Accessibility compliance
- Performance benchmarks

**WorkflowManager Tests** (`/tests/frontend/workflow-manager.test.js`):
- State machine behavior
- Progress tracking
- Error recovery
- Integration with event handlers
- Collaboration workflows
- Memory management

**Integration Tests** (`/tests/frontend/frontend.spec.js`):
- Full application initialization
- HITL workflow simulation
- WebSocket communication
- Error handling and recovery
- Responsive design
- Performance optimization

## Key Design Patterns

### 1. Component Composition
- Functional components with hooks
- Context-based state management
- Render props for complex UIs
- Error boundaries for fault tolerance

### 2. Event-Driven Architecture
- Centralized event service
- Decoupled component communication
- Real-time updates via WebSocket
- Event history for debugging

### 3. Progressive Enhancement
- Graceful degradation for offline scenarios
- Loading states for better UX
- Fallback UIs for error conditions
- Accessibility-first design

## Performance Considerations

### 1. Code Splitting
- Dynamic imports for large components
- Route-based code splitting
- Lazy loading for UI components
- Bundle size optimization

### 2. Rendering Optimization
- React.memo for expensive components
- useCallback for stable function references
- useMemo for computed values
- Virtual scrolling for large lists

### 3. Network Optimization
- Request batching and caching
- WebSocket connection pooling
- Offline capability with service workers
- CDN integration for static assets

## Security Features

### 1. Content Security
- Iframe sandboxing for UI isolation
- Input sanitization for user-generated content
- CSRF protection for API calls
- XSS prevention through React's JSX

### 2. Authentication
- JWT-based session management
- Secure WebSocket connections
- Token refresh mechanisms
- Session timeout handling

### 3. Data Protection
- Sensitive data masking in logs
- Secure transmission via HTTPS/WSS
- Local storage encryption for sensitive data
- Audit logging for compliance

## Development Workflow

### 1. Local Development
```bash
npm run dev          # Start development server
npm run test         # Run test suite
npm run test:watch   # Watch mode for tests
npm run build        # Production build
npm run lint         # Code linting
```

### 2. Testing Commands
```bash
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests
npm run test:e2e         # End-to-end tests
npm run test:coverage    # Coverage report
npm run playwright       # Playwright browser tests
```

### 3. Deployment
```bash
npm run build         # Build for production
npm run test:all      # Full test suite
npm run deploy        # Deploy to production
```

## Configuration

### Environment Variables
- `REACT_APP_API_URL` - Backend API base URL
- `REACT_APP_WS_URL` - WebSocket server URL
- `REACT_APP_DEBUG_MODE` - Enable debug features
- `REACT_APP_VERSION` - Application version

### Runtime Configuration
- UI type selection (Streamlit/Gradio/Custom)
- Debug mode toggle
- Theme preferences
- Timeout configurations
- Retry strategies

## Future Enhancements

### 1. Advanced Features
- Real-time collaboration
- Multi-session management
- Advanced visualizations
- Mobile app support
- Offline functionality

### 2. Performance Improvements
- Web Workers for heavy computations
- Service worker caching strategies
- Progressive Web App (PWA) features
- Server-side rendering (SSR)
- Static site generation (SSG)

### 3. Developer Experience
- Component library documentation
- Storybook integration
- TypeScript migration
- Enhanced debugging tools
- Performance profiling

## Troubleshooting

### Common Issues
- **WebSocket connection failures**: Check backend service status
- **UI loading errors**: Verify iframe sandboxing configuration
- **Event handling problems**: Check event service initialization
- **Performance issues**: Monitor bundle size and render times
- **Memory leaks**: Check component cleanup and event unregistration

### Debug Tools
- React DevTools for component inspection
- Browser DevTools for network analysis
- Playwright Trace Viewer for E2E test debugging
- AG-UI event history for real-time debugging
- Performance metrics for optimization

## API Reference

### AG-UI Protocol Events
See `/src/frontend/services/events.js` for complete event definitions and examples.

### Component Props
Each component exports TypeScript interfaces for prop definitions and documentation.

### Service Methods
Detailed API documentation available through JSDoc comments in service files.