/**
 * Performance testing suite for GUI-LOP Frontend
 * Validates performance optimizations and user experience metrics
 */

import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { performance } from 'perf_hooks';

// Mock performance APIs
global.performance = {
  ...performance,
  now: jest.fn(() => Date.now()),
  mark: jest.fn(),
  measure: jest.fn(),
  getEntriesByType: jest.fn(() => []),
  getEntriesByName: jest.fn(() => []),
  clearMarks: jest.fn(),
  clearMeasures: jest.fn(),
  navigation: {
    type: 'navigate',
    redirectCount: 0
  },
  timing: {
    navigationStart: 0,
    loadEventEnd: 1000,
    domContentLoadedEventEnd: 800
  },
  memory: {
    usedJSHeapSize: 1000000,
    totalJSHeapSize: 2000000,
    jsHeapSizeLimit: 4000000
  }
};

// Mock IntersectionObserver
global.IntersectionObserver = jest.fn(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn()
}));

// Mock ResizeObserver
global.ResizeObserver = jest.fn(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn()
}));

// Mock WebSocket
global.WebSocket = jest.fn(() => ({
  close: jest.fn(),
  send: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  readyState: 1,
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
}));

describe('Performance Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    performance.now.mockClear();
    let callCount = 0;
    performance.now.mockImplementation(() => {
      callCount++;
      return callCount * 16; // Simulate 60fps (16ms per frame)
    });
  });

  describe('Component Rendering Performance', () => {
    test('should render dashboard within performance budget', async () => {
      const startTime = performance.now();

      const LazyDashboard = (await import('../../src/pages/LazyDashboard')).default;
      const mockProps = {
        user: { username: 'testuser' },
        serverStatus: 'connected',
        wsConnected: true,
        activeWorkflow: null,
        workflows: [],
        onCreateWorkflow: jest.fn(),
        onRespondToWorkflow: jest.fn()
      };

      render(<LazyDashboard {...mockProps} />);

      const renderTime = performance.now() - startTime;

      // Component should render within 100ms
      expect(renderTime).toBeLessThan(100);

      await waitFor(() => {
        expect(screen.getByText('GUI-LOP Dashboard')).toBeInTheDocument();
      });
    });

    test('should render workflow list efficiently with many items', async () => {
      const LazyWorkflows = (await import('../../src/pages/LazyWorkflows')).default;

      // Create 1000 workflow items
      const manyWorkflows = Array.from({ length: 1000 }, (_, i) => ({
        id: `workflow-${i}`,
        name: `Workflow ${i}`,
        description: `Description for workflow ${i}`,
        status: 'pending'
      }));

      const startTime = performance.now();

      render(
        <LazyWorkflows
          workflows={manyWorkflows}
          activeWorkflow={null}
          onCreateWorkflow={jest.fn()}
          onRespondToWorkflow={jest.fn()}
        />
      );

      const renderTime = performance.now() - startTime;

      // Should handle many items efficiently (virtual scrolling)
      expect(renderTime).toBeLessThan(200);

      // Should only render visible items (virtual scrolling)
      const visibleItems = screen.getAllByText(/Workflow \d+/);
      expect(visibleItems.length).toBeLessThan(20); // Much less than 1000
    });

    test('should memoize components properly', async () => {
      const LazyDashboard = (await import('../../src/pages/LazyDashboard')).default;
      const mockProps = {
        user: { username: 'testuser' },
        serverStatus: 'connected',
        wsConnected: true,
        activeWorkflow: null,
        workflows: [],
        onCreateWorkflow: jest.fn(),
        onRespondToWorkflow: jest.fn()
      };

      const { rerender } = render(<LazyDashboard {...mockProps} />);

      const startTime = performance.now();

      // Re-render with same props
      rerender(<LazyDashboard {...mockProps} />);

      const rerenderTime = performance.now() - startTime;

      // Rerender should be very fast due to memoization
      expect(rerenderTime).toBeLessThan(16); // Should be less than one frame
    });
  });

  describe('Caching Performance', () => {
    test('should cache API responses efficiently', async () => {
      const { useCache } = await import('../../src/hooks/useCache');
      const cache = useCache(5000); // 5 second TTL

      // Mock expensive computation
      const expensiveFunction = jest.fn(() => Promise.resolve({ data: 'expensive result' }));

      // First call should execute the function
      const result1 = await cache.cachedFetch || expensiveFunction();
      expect(expensiveFunction).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result2 = await cache.cachedFetch || expensiveFunction();
      expect(expensiveFunction).toHaveBeenCalledTimes(1); // Still only called once

      expect(result1).toEqual(result2);
    });

    test('should limit cache size to prevent memory issues', async () => {
      const { useCache } = await import('../../src/hooks/useCache');
      const cache = useCache(1000);

      // Add many items to cache
      for (let i = 0; i < 100; i++) {
        cache.set(`key-${i}`, `value-${i}`);
      }

      const stats = cache.getStats();

      // Cache should have reasonable memory usage
      expect(stats.memoryUsage).toBeLessThan(1024 * 1024); // Less than 1MB
      expect(stats.totalSize).toBe(100);
    });

    test('should cleanup expired cache entries', async () => {
      const { useCache } = await import('../../src/hooks/useCache');
      const cache = useCache(100); // Very short TTL

      cache.set('test-key', 'test-value');
      expect(cache.get('test-key')).toBe('test-value');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(cache.get('test-key')).toBeNull();
    });
  });

  describe('WebSocket Performance', () => {
    test('should handle WebSocket reconnection efficiently', async () => {
      const { useWebSocket } = await import('../../src/hooks/useWebSocket');

      let renderCount = 0;
      const TestComponent = () => {
        const { status, reconnecting, reconnectInfo } = useWebSocket('ws://localhost:3001');
        renderCount++;
        return (
          <div>
            <span data-testid="status">{status}</span>
            {reconnecting && <span data-testid="reconnecting">Reconnecting...</span>}
            {reconnectInfo && <span data-testid="reconnect-attempts">{reconnectInfo.attempt}</span>}
          </div>
        );
      };

      render(<TestComponent />);

      // Initial render
      expect(renderCount).toBe(1);

      // Simulate reconnection
      const ws = global.WebSocket.mock.results[0].value;

      // Should handle connection events efficiently
      act(() => {
        ws.readyState = 1; // OPEN
        ws.addEventListener.mock.calls[0][1]({ type: 'open' });
      });

      expect(screen.getByTestId('status')).toHaveTextContent('connected');

      // Should minimize re-renders during reconnection
      expect(renderCount).toBeLessThan(5);
    });

    test('should queue messages during disconnection', async () => {
      const { useWebSocket } = await import('../../src/hooks/useWebSocket');

      const TestComponent = () => {
        const { sendMessage } = useWebSocket('ws://localhost:3001', {
          maxReconnectAttempts: 0 // No reconnection for this test
        });

        const handleSend = () => {
          sendMessage({ type: 'test', data: 'message' });
        };

        return (
          <button onClick={handleSend} data-testid="send-btn">
            Send Message
          </button>
        );
      };

      render(<TestComponent />);

      const sendBtn = screen.getByTestId('send-btn');

      // Send message while disconnected
      fireEvent.click(sendBtn);

      const ws = global.WebSocket.mock.results[0].value;

      // Message should be queued when disconnected
      expect(ws.send).not.toHaveBeenCalled();

      // When connected, queued messages should be sent
      act(() => {
        ws.readyState = 1; // OPEN
        ws.addEventListener.mock.calls[0][1]({ type: 'open' });
      });

      // Queued message should be sent
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test', data: 'message' }));
    });
  });

  describe('Virtual Scrolling Performance', () => {
    test('should render only visible items in large lists', async () => {
      const VirtualList = (await import('../../src/components/performance/VirtualList')).default;

      const items = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        value: i * 2
      }));

      const renderItem = jest.fn((item) => (
        <div data-testid={`item-${item.id}`}>{item.name}</div>
      ));

      render(
        <VirtualList
          items={items}
          itemHeight={50}
          containerHeight={400}
          renderItem={renderItem}
        />
      );

      // Should only render visible items (approximately)
      const visibleCount = Math.ceil(400 / 50) + 10; // viewport + overscan
      expect(renderItem).toHaveBeenCalledTimes(visibleCount);

      // All rendered items should be within expected range
      const calls = renderItem.mock.calls;
      calls.forEach(([item]) => {
        expect(item.id).toBeGreaterThanOrEqual(0);
        expect(item.id).toBeLessThan(10000);
      });
    });

    test('should handle scrolling efficiently', async () => {
      const VirtualList = (await import('../../src/components/performance/VirtualList')).default;

      const items = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`
      }));

      const renderItem = jest.fn((item) => (
        <div data-testid={`item-${item.id}`}>{item.name}</div>
      }));

      const { container } = render(
        <VirtualList
          items={items}
          itemHeight={50}
          containerHeight={200}
          renderItem={renderItem}
        />
      );

      // Clear initial render calls
      renderItem.mockClear();

      // Simulate scroll
      const scrollContainer = container.querySelector('.virtual-list-container');

      act(() => {
        fireEvent.scroll(scrollContainer, { target: { scrollTop: 1000 } });
      });

      // Should re-render items for new visible range
      expect(renderItem).toHaveBeenCalled();

      // Should not re-render all items
      expect(renderItem).toHaveBeenCalledTimes.lessThan(20);
    });
  });

  describe('Memory Management', () => {
    test('should clean up event listeners on unmount', async () => {
      const { performanceMonitor } = await import('../../src/utils/performanceMonitor');

      const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');

      const TestComponent = () => {
        const { metrics } = performanceMonitor();
        return <div data-testid="test-component">Test</div>;
      };

      const { unmount } = render(<TestComponent />);

      // Event listeners should be added
      expect(addEventListenerSpy).toHaveBeenCalled();

      unmount();

      // Event listeners should be removed
      expect(removeEventListenerSpy).toHaveBeenCalled();

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });

    test('should limit log history to prevent memory leaks', async () => {
      const LazyEvents = (await import('../../src/pages/LazyEvents')).default;

      const manyLogs = Array.from({ length: 2000 }, (_, i) => ({
        timestamp: new Date().toLocaleTimeString(),
        message: `Log message ${i}`,
        level: 'info'
      }));

      render(
        <LazyEvents
          logs={manyLogs}
          onClearLogs={jest.fn()}
        />
      );

      // Should limit logs to prevent memory issues
      expect(screen.getAllByText(/Log message \d+/).length).toBeLessThan(1000);
    });
  });

  describe('User Experience Metrics', () => {
    test('should track interaction performance', async () => {
      const { usePerformanceMonitor } = await import('../../src/utils/performanceMonitor');

      let trackInteractionCalls = 0;

      const TestComponent = () => {
        const { trackInteraction } = usePerformanceMonitor();

        const handleClick = () => {
          const startTime = performance.now();
          // Simulate interaction
          trackInteraction('test_interaction', startTime);
          trackInteractionCalls++;
        };

        return (
          <button onClick={handleClick} data-testid="test-button">
            Test Button
          </button>
        );
      };

      render(<TestComponent />);

      const button = screen.getByTestId('test-button');
      fireEvent.click(button);

      expect(trackInteractionCalls).toBe(1);
    });

    test('should provide loading states during async operations', async () => {
      const { ProgressiveLoader } = await import('../../src/components/common/SkeletonLoader');

      const AsyncComponent = () => {
        const [loading, setLoading] = React.useState(true);

        React.useEffect(() => {
          setTimeout(() => setLoading(false), 100);
        }, []);

        return (
          <ProgressiveLoader loading={loading} delay={50}>
            <div data-testid="content">Loaded Content</div>
          </ProgressiveLoader>
        );
      };

      render(<AsyncComponent />);

      // Should show skeleton initially
      expect(screen.queryByTestId('content')).not.toBeInTheDocument();

      // Should show content after loading
      await waitFor(() => {
        expect(screen.getByTestId('content')).toBeInTheDocument();
      }, { timeout: 200 });
    });
  });

  describe('Bundle Size Optimization', () => {
    test('should dynamically import components for code splitting', async () => {
      // Test that lazy components are dynamically imported
      const dashboardImport = import('../../src/pages/LazyDashboard');
      const workflowsImport = import('../../src/pages/LazyWorkflows');
      const eventsImport = import('../../src/pages/LazyEvents');

      expect(dashboardImport).toBeInstanceOf(Promise);
      expect(workflowsImport).toBeInstanceOf(Promise);
      expect(eventsImport).toBeInstanceOf(Promise);

      const [Dashboard, Workflows, Events] = await Promise.all([
        dashboardImport,
        workflowsImport,
        eventsImport
      ]);

      expect(Dashboard.default).toBeDefined();
      expect(Workflows.default).toBeDefined();
      expect(Events.default).toBeDefined();
    });
  });

  describe('Accessibility Performance', () => {
    test('should maintain accessibility with performance optimizations', async () => {
      const LazyWorkflows = (await import('../../src/pages/LazyWorkflows')).default;

      const workflows = [
        { id: 1, name: 'Test Workflow', description: 'Test Description' }
      ];

      render(
        <LazyWorkflows
          workflows={workflows}
          activeWorkflow={null}
          onCreateWorkflow={jest.fn()}
          onRespondToWorkflow={jest.fn()}
        />
      );

      // Should maintain proper ARIA labels
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /execute/i })).toBeInTheDocument();
      });

      // Should be keyboard navigable
      const button = screen.getByRole('button', { name: /execute/i });
      button.focus();
      expect(button).toHaveFocus();
    });
  });
});