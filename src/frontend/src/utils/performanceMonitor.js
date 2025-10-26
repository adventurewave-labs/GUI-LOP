/**
 * Performance monitoring utilities for GUI-LOP Frontend
 * Provides real-time performance metrics and user experience tracking
 */

// Performance metrics storage
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      navigation: {},
      resources: [],
      userInteractions: [],
      memory: [],
      render: [],
      network: []
    };
    this.observers = new Map();
    this.isSupported = this.checkSupport();
  }

  checkSupport() {
    return (
      typeof window !== 'undefined' &&
      'performance' in window &&
      'PerformanceObserver' in window &&
      'IntersectionObserver' in window
    );
  }

  // Initialize performance monitoring
  init() {
    if (!this.isSupported) {
      console.warn('Performance monitoring not supported');
      return;
    }

    this.observeNavigation();
    this.observeResources();
    this.observeLongTasks();
    this.observeLayoutShift();
    this.observeMemory();
    this.trackFirstContentfulPaint();
  }

  // Track navigation timing
  observeNavigation() {
    if ('PerformanceNavigationTiming' in window) {
      const navEntry = performance.getEntriesByType('navigation')[0];
      if (navEntry) {
        this.metrics.navigation = {
          dns: navEntry.domainLookupEnd - navEntry.domainLookupStart,
          tcp: navEntry.connectEnd - navEntry.connectStart,
          ssl: navEntry.secureConnectionStart > 0 ? navEntry.connectEnd - navEntry.secureConnectionStart : 0,
          ttfb: navEntry.responseStart - navEntry.requestStart,
          download: navEntry.responseEnd - navEntry.responseStart,
          domParse: navEntry.domContentLoadedEventStart - navEntry.responseEnd,
          domReady: navEntry.domContentLoadedEventEnd - navEntry.domContentLoadedEventStart,
          loadComplete: navEntry.loadEventEnd - navEntry.loadEventStart,
          total: navEntry.loadEventEnd - navEntry.navigationStart
        };
      }
    }
  }

  // Track resource loading
  observeResources() {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'resource') {
            this.metrics.resources.push({
              name: entry.name,
              type: this.getResourceType(entry.name),
              duration: entry.duration,
              size: entry.transferSize || 0,
              cached: entry.transferSize === 0 && entry.decodedBodySize > 0
            });
          }
        }
      });

      observer.observe({ entryTypes: ['resource'] });
      this.observers.set('resources', observer);
    } catch (error) {
      console.warn('Resource observer not supported:', error);
    }
  }

  // Track long tasks that block the main thread
  observeLongTasks() {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.metrics.render.push({
            type: 'long-task',
            duration: entry.duration,
            startTime: entry.startTime
          });
        }
      });

      observer.observe({ entryTypes: ['longtask'] });
      this.observers.set('longtasks', observer);
    } catch (error) {
      console.warn('Long task observer not supported:', error);
    }
  }

  // Track layout shifts for visual stability
  observeLayoutShift() {
    try {
      let clsScore = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            clsScore += entry.value;
          }
        }
        this.metrics.render.push({
          type: 'cls',
          value: clsScore,
          timestamp: entry.startTime
        });
      });

      observer.observe({ entryTypes: ['layout-shift'] });
      this.observers.set('layoutshift', observer);
    } catch (error) {
      console.warn('Layout shift observer not supported:', error);
    }
  }

  // Track memory usage
  observeMemory() {
    if ('memory' in performance) {
      const measure = () => {
        this.metrics.memory.push({
          used: performance.memory.usedJSHeapSize,
          total: performance.memory.totalJSHeapSize,
          limit: performance.memory.jsHeapSizeLimit,
          timestamp: performance.now()
        });
      };

      // Measure immediately and then every 5 seconds
      measure();
      setInterval(measure, 5000);
    }
  }

  // Track First Contentful Paint
  trackFirstContentfulPaint() {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            this.metrics.render.push({
              type: 'fcp',
              value: entry.startTime,
              timestamp: entry.startTime
            });
            observer.disconnect();
          }
        }
      });

      observer.observe({ entryTypes: ['paint'] });
    } catch (error) {
      console.warn('Paint observer not supported:', error);
    }
  }

  // Track user interaction performance
  trackInteraction(name, startTime, endTime = performance.now()) {
    const duration = endTime - startTime;
    this.metrics.userInteractions.push({
      name,
      duration,
      timestamp: startTime
    });
  }

  // Get resource type from URL
  getResourceType(url) {
    if (url.includes('.css')) return 'css';
    if (url.includes('.js')) return 'javascript';
    if (url.match(/\.(png|jpg|jpeg|gif|svg|webp)$/)) return 'image';
    if (url.match(/\.(woff|woff2|ttf|eot)$/)) return 'font';
    return 'other';
  }

  // Get performance report
  getReport() {
    return {
      navigation: this.metrics.navigation,
      resources: this.metrics.resources.slice(-20), // Last 20 resources
      userInteractions: this.metrics.userInteractions.slice(-10), // Last 10 interactions
      memory: this.metrics.memory.slice(-5), // Last 5 measurements
      render: this.metrics.render,
      summary: this.generateSummary()
    };
  }

  // Generate performance summary
  generateSummary() {
    const longTasks = this.metrics.render.filter(task => task.type === 'long-task');
    const clsEntries = this.metrics.render.filter(entry => entry.type === 'cls');
    const fcpEntry = this.metrics.render.find(entry => entry.type === 'fcp');

    return {
      totalResources: this.metrics.resources.length,
      cachedResources: this.metrics.resources.filter(r => r.cached).length,
      averageResourceTime: this.getAverageResourceTime(),
      totalLongTasks: longTasks.length,
      longestTask: Math.max(...longTasks.map(t => t.duration), 0),
      cls: clsEntries.length > 0 ? clsEntries[clsEntries.length - 1].value : 0,
      fcp: fcpEntry ? fcpEntry.value : null,
      currentMemoryUsage: this.metrics.memory.length > 0
        ? this.metrics.memory[this.metrics.memory.length - 1]
        : null
    };
  }

  getAverageResourceTime() {
    if (this.metrics.resources.length === 0) return 0;
    const total = this.metrics.resources.reduce((sum, resource) => sum + resource.duration, 0);
    return total / this.metrics.resources.length;
  }

  // Cleanup observers
  cleanup() {
    this.observers.forEach(observer => observer.disconnect());
    this.observers.clear();
  }
}

// React hook for performance monitoring
export const usePerformanceMonitor = () => {
  const [metrics, setMetrics] = React.useState(null);
  const monitorRef = React.useRef(null);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      monitorRef.current = new PerformanceMonitor();
      monitorRef.current.init();

      // Update metrics every 2 seconds
      const interval = setInterval(() => {
        if (monitorRef.current) {
          setMetrics(monitorRef.current.getReport());
        }
      }, 2000);

      return () => {
        clearInterval(interval);
        if (monitorRef.current) {
          monitorRef.current.cleanup();
        }
      };
    }
  }, []);

  const trackInteraction = React.useCallback((name, startTime) => {
    if (monitorRef.current) {
      monitorRef.current.trackInteraction(name, startTime);
    }
  }, []);

  return { metrics, trackInteraction };
};

// Performance tracking wrapper for components
export const withPerformanceTracking = (WrappedComponent, componentName) => {
  return React.memo((props) => {
    const renderStart = React.useRef(performance.now());
    const { trackInteraction } = usePerformanceMonitor();

    React.useEffect(() => {
      const renderTime = performance.now() - renderStart.current;
      trackInteraction(`${componentName}_render`, renderStart.current);
    });

    return <WrappedComponent {...props} />;
  });
};

export default PerformanceMonitor;