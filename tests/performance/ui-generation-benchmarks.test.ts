import { performance } from 'perf_hooks';
import { Benchmark } from 'benchmark';
import { UIGenerator } from '../../src/backend/agents/ui-generator.js';
import { TestDataGenerator } from '../helpers/test-data-generator.js';
import { MemoryMonitor } from '../helpers/memory-monitor.js';

describe('UI Generation Performance Benchmarks', () => {
  let uiGenerator: UIGenerator;
  let dataGenerator: TestDataGenerator;
  let memoryMonitor: MemoryMonitor;
  let suite: Benchmark.Suite;

  beforeAll(() => {
    uiGenerator = new UIGenerator({
      enableCaching: true,
      maxCacheSize: 100,
      enableCompression: true
    });

    dataGenerator = new TestDataGenerator();
    memoryMonitor = new MemoryMonitor();

    suite = new Benchmark.Suite('UI Generation Performance');
  });

  beforeEach(() => {
    memoryMonitor.startMonitoring();
  });

  afterEach(() => {
    memoryMonitor.stopMonitoring();
    uiGenerator.clearCache();
  });

  describe('Dashboard UI Generation', () => {
    it('should generate simple dashboard under 500ms', async () => {
      const dashboardConfig = {
        type: 'simple-dashboard',
        components: ['chart', 'table', 'filters'],
        data: dataGenerator.generateSmallDataset()
      };

      const startTime = performance.now();
      const result = await uiGenerator.generateDashboard(dashboardConfig);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(result).toBeDefined();
      expect(result.html).toBeDefined();
      expect(result.javascript).toBeDefined();
      expect(duration).toBeLessThan(500); // < 500ms requirement

      console.log(`Simple dashboard generation: ${duration.toFixed(2)}ms`);
    });

    it('should generate complex dashboard under 2 seconds', async () => {
      const dashboardConfig = {
        type: 'complex-dashboard',
        components: [
          'multi-chart',
          'real-time-table',
          'advanced-filters',
          'export-controls',
          'collaboration-panel'
        ],
        data: dataGenerator.generateLargeDataset(),
        features: {
          realTimeUpdates: true,
          collaborativeEditing: true,
          advancedFiltering: true,
          exportOptions: ['pdf', 'excel', 'csv']
        }
      };

      const startTime = performance.now();
      const result = await uiGenerator.generateDashboard(dashboardConfig);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(result).toBeDefined();
      expect(result.html).toBeDefined();
      expect(result.javascript).toBeDefined();
      expect(duration).toBeLessThan(2000); // < 2s requirement

      console.log(`Complex dashboard generation: ${duration.toFixed(2)}ms`);
    });

    it('should handle concurrent dashboard generation efficiently', async () => {
      const concurrency = 10;
      const dashboardConfigs = Array(concurrency).fill(null).map((_, i) => ({
        type: 'concurrent-dashboard',
        id: `dashboard-${i}`,
        components: ['chart', 'table'],
        data: dataGenerator.generateMediumDataset()
      }));

      const startTime = performance.now();

      const promises = dashboardConfigs.map(config =>
        uiGenerator.generateDashboard(config)
      );

      const results = await Promise.all(promises);

      const endTime = performance.now();
      const totalTime = endTime - startTime;
      const averageTime = totalTime / concurrency;

      expect(results).toHaveLength(concurrency);
      results.forEach(result => {
        expect(result.html).toBeDefined();
        expect(result.javascript).toBeDefined();
      });

      // Average time per dashboard should be reasonable
      expect(averageTime).toBeLessThan(800);

      console.log(`Concurrent dashboard generation (${concurrency}): ${totalTime.toFixed(2)}ms total, ${averageTime.toFixed(2)}ms average`);
    });
  });

  describe('Form UI Generation', () => {
    it('should generate simple forms under 200ms', async () => {
      const formConfig = {
        type: 'simple-form',
        fields: [
          { name: 'name', type: 'text', required: true },
          { name: 'email', type: 'email', required: true },
          { name: 'submit', type: 'button' }
        ]
      };

      const startTime = performance.now();
      const result = await uiGenerator.generateForm(formConfig);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(result).toBeDefined();
      expect(result.html).toBeDefined();
      expect(duration).toBeLessThan(200);

      console.log(`Simple form generation: ${duration.toFixed(2)}ms`);
    });

    it('should generate complex forms under 1 second', async () => {
      const formConfig = {
        type: 'complex-form',
        fields: [
          { name: 'personalInfo', type: 'fieldset', fields: [
            { name: 'firstName', type: 'text', required: true },
            { name: 'lastName', type: 'text', required: true },
            { name: 'birthDate', type: 'date', required: true }
          ]},
          { name: 'preferences', type: 'fieldset', fields: [
            { name: 'notifications', type: 'checkbox', options: ['email', 'sms', 'push'] },
            { name: 'theme', type: 'select', options: ['light', 'dark', 'auto'] },
            { name: 'language', type: 'select', options: ['en', 'es', 'fr', 'de'] }
          ]},
          { name: 'documents', type: 'file', multiple: true, maxFiles: 5 },
          { name: 'terms', type: 'checkbox', required: true }
        ],
        validation: {
          enableRealTime: true,
          showErrorSummary: true
        }
      };

      const startTime = performance.now();
      const result = await uiGenerator.generateForm(formConfig);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(result).toBeDefined();
      expect(result.html).toBeDefined();
      expect(result.validation).toBeDefined();
      expect(duration).toBeLessThan(1000);

      console.log(`Complex form generation: ${duration.toFixed(2)}ms`);
    });
  });

  describe('Data Visualization Generation', () => {
    it('should generate chart visualizations under 300ms', async () => {
      const chartConfig = {
        type: 'bar-chart',
        data: dataGenerator.generateChartData(100),
        options: {
          responsive: true,
          interactive: true,
          animations: true
        }
      };

      const startTime = performance.now();
      const result = await uiGenerator.generateChart(chartConfig);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(result).toBeDefined();
      expect(result.canvas).toBeDefined();
      expect(result.javascript).toBeDefined();
      expect(duration).toBeLessThan(300);

      console.log(`Chart visualization generation: ${duration.toFixed(2)}ms`);
    });

    it('should generate real-time charts under 500ms', async () => {
      const chartConfig = {
        type: 'real-time-line-chart',
        data: dataGenerator.generateTimeSeriesData(50),
        options: {
          realTime: true,
          updateInterval: 1000,
          maxDataPoints: 100,
          smoothAnimations: true
        }
      };

      const startTime = performance.now();
      const result = await uiGenerator.generateChart(chartConfig);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(result).toBeDefined();
      expect(result.websocketConfig).toBeDefined();
      expect(duration).toBeLessThan(500);

      console.log(`Real-time chart generation: ${duration.toFixed(2)}ms`);
    });
  });

  describe('Memory Efficiency Tests', () => {
    it('should maintain memory usage under 50MB for batch operations', async () => {
      const batchSize = 50;
      const initialMemory = memoryMonitor.getCurrentMemory();

      for (let i = 0; i < batchSize; i++) {
        const config = {
          type: 'memory-test-dashboard',
          id: `test-${i}`,
          components: ['chart', 'table'],
          data: dataGenerator.generateMediumDataset()
        };

        await uiGenerator.generateDashboard(config);

        if (i % 10 === 0) {
          // Force garbage collection if available
          if (global.gc) {
            global.gc();
          }
        }
      }

      const finalMemory = memoryMonitor.getCurrentMemory();
      const memoryIncrease = finalMemory - initialMemory;

      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // < 50MB

      console.log(`Memory increase for ${batchSize} operations: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
    });

    it('should properly clean up resources after UI generation', async () => {
      const config = {
        type: 'cleanup-test',
        components: ['chart', 'table', 'filters'],
        data: dataGenerator.generateLargeDataset()
      };

      const beforeMemory = memoryMonitor.getCurrentMemory();

      // Generate UI
      const result = await uiGenerator.generateDashboard(config);
      expect(result).toBeDefined();

      const afterGeneration = memoryMonitor.getCurrentMemory();

      // Simulate cleanup
      uiGenerator.cleanup(config.id);

      if (global.gc) {
        global.gc();
      }

      const afterCleanup = memoryMonitor.getCurrentMemory();

      // Memory should return close to initial level
      const memoryLeak = afterCleanup - beforeMemory;
      expect(memoryLeak).toBeLessThan(5 * 1024 * 1024); // < 5MB leak tolerance

      console.log(`Memory usage - Before: ${(beforeMemory / 1024 / 1024).toFixed(2)}MB, ` +
                  `After generation: ${(afterGeneration / 1024 / 1024).toFixed(2)}MB, ` +
                  `After cleanup: ${(afterCleanup / 1024 / 1024).toFixed(2)}MB`);
    });
  });

  describe('Caching Performance', () => {
    it('should improve performance with caching enabled', async () => {
      const config = {
        type: 'cached-dashboard',
        components: ['chart', 'table'],
        data: dataGenerator.generateMediumDataset()
      };

      // First generation (cache miss)
      const startTime1 = performance.now();
      await uiGenerator.generateDashboard(config);
      const duration1 = performance.now() - startTime1;

      // Second generation (cache hit)
      const startTime2 = performance.now();
      await uiGenerator.generateDashboard(config);
      const duration2 = performance.now() - startTime2;

      // Cached generation should be significantly faster
      expect(duration2).toBeLessThan(duration1 * 0.5); // At least 50% faster

      console.log(`Without cache: ${duration1.toFixed(2)}ms, With cache: ${duration2.toFixed(2)}ms`);
    });

    it('should handle cache eviction efficiently', async () => {
      const cacheSize = 20;
      const configs = Array(cacheSize + 10).fill(null).map((_, i) => ({
        type: 'cache-eviction-test',
        id: `config-${i}`,
        components: ['chart'],
        data: dataGenerator.generateSmallDataset()
      }));

      // Generate all configs (should trigger eviction)
      for (const config of configs) {
        await uiGenerator.generateDashboard(config);
      }

      // Verify cache size is maintained
      const cacheStats = uiGenerator.getCacheStats();
      expect(cacheStats.size).toBeLessThanOrEqual(cacheSize);

      // Verify performance remains stable after eviction
      const startTime = performance.now();
      await uiGenerator.generateDashboard(configs[cacheSize]); // Should be cache miss
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(1000); // Should still be fast

      console.log(`Cache eviction test - Cache size: ${cacheStats.size}, Latest generation: ${duration.toFixed(2)}ms`);
    });
  });

  describe('Scalability Tests', () => {
    it('should handle large dataset visualization efficiently', async () => {
      const largeDataset = dataGenerator.generateLargeDataset(10000); // 10k records

      const config = {
        type: 'large-data-visualization',
        components: ['paginated-table', 'summary-chart'],
        data: largeDataset,
        features: {
          virtualScrolling: true,
          pagination: true,
          dataAggregation: true
        }
      };

      const startTime = performance.now();
      const result = await uiGenerator.generateDashboard(config);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(result).toBeDefined();
      expect(result.html).toBeDefined();
      expect(duration).toBeLessThan(3000); // < 3s for large dataset

      console.log(`Large dataset (10k records) visualization: ${duration.toFixed(2)}ms`);
    });

    it('should handle multi-component dashboard generation', async () => {
      const config = {
        type: 'multi-component-dashboard',
        components: [
          'kpi-cards',
          'line-chart',
          'bar-chart',
          'data-table',
          'filters',
          'export-controls'
        ],
        data: dataGenerator.generateMediumDataset(),
        layout: 'grid',
        responsive: true
      };

      const startTime = performance.now();
      const result = await uiGenerator.generateDashboard(config);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(result).toBeDefined();
      expect(result.components).toHaveLength(6);
      expect(duration).toBeLessThan(2000);

      console.log(`Multi-component dashboard (6 components): ${duration.toFixed(2)}ms`);
    });
  });

  describe('Benchmark Suite', () => {
    it('should run comprehensive benchmark suite', async () => {
      // Add benchmarks to suite
      suite
        .add('Simple Dashboard', {
          defer: true,
          fn: async (deferred) => {
            const config = {
              type: 'simple-dashboard',
              components: ['chart', 'table'],
              data: dataGenerator.generateSmallDataset()
            };
            await uiGenerator.generateDashboard(config);
            deferred.resolve();
          }
        })
        .add('Complex Dashboard', {
          defer: true,
          fn: async (deferred) => {
            const config = {
              type: 'complex-dashboard',
              components: ['chart', 'table', 'filters', 'export'],
              data: dataGenerator.generateMediumDataset()
            };
            await uiGenerator.generateDashboard(config);
            deferred.resolve();
          }
        })
        .add('Form Generation', {
          defer: true,
          fn: async (deferred) => {
            const config = {
              type: 'complex-form',
              fields: [
                { name: 'text', type: 'text' },
                { name: 'select', type: 'select' },
                { name: 'checkbox', type: 'checkbox' }
              ]
            };
            await uiGenerator.generateForm(config);
            deferred.resolve();
          }
        })
        .add('Chart Generation', {
          defer: true,
          fn: async (deferred) => {
            const config = {
              type: 'line-chart',
              data: dataGenerator.generateChartData(100)
            };
            await uiGenerator.generateChart(config);
            deferred.resolve();
          }
        })
        .on('cycle', (event: any) => {
          console.log(String(event.target));
        })
        .on('complete', () => {
          console.log('Benchmark suite completed');
          console.log('Fastest is ' + suite.filter('fastest').map('name'));
        });

      // Run the benchmark suite
      await new Promise<void>((resolve) => {
        suite.run({ async: true });
        suite.on('complete', () => resolve());
      });

      const results = suite.map((bench: Benchmark) => ({
        name: bench.name,
        hz: bench.hz,
        mean: bench.stats.mean,
        deviation: bench.stats.deviation
      }));

      // Verify performance meets requirements
      const simpleDashboardResult = results.find(r => r.name === 'Simple Dashboard');
      const complexDashboardResult = results.find(r => r.name === 'Complex Dashboard');

      if (simpleDashboardResult) {
        expect(simpleDashboardResult.mean).toBeLessThan(0.5); // < 500ms
      }

      if (complexDashboardResult) {
        expect(complexDashboardResult.mean).toBeLessThan(2.0); // < 2s
      }

      console.log('Benchmark Results:', results);
    });
  });

  describe('Regression Tests', () => {
    it('should maintain performance over multiple generations', async () => {
      const generations = 100;
      const config = {
        type: 'regression-test',
        components: ['chart', 'table'],
        data: dataGenerator.generateMediumDataset()
      };

      const times: number[] = [];

      for (let i = 0; i < generations; i++) {
        const startTime = performance.now();
        await uiGenerator.generateDashboard(config);
        const duration = performance.now() - startTime;
        times.push(duration);

        if (i % 20 === 0 && global.gc) {
          global.gc();
        }
      }

      const averageTime = times.reduce((a, b) => a + b) / times.length;
      const maxTime = Math.max(...times);
      const minTime = Math.min(...times);

      // Performance should remain consistent
      expect(averageTime).toBeLessThan(800);
      expect(maxTime).toBeLessThan(2000); // No single generation should be too slow

      // Performance degradation should be minimal
      const firstHalf = times.slice(0, 50);
      const secondHalf = times.slice(50);
      const firstHalfAvg = firstHalf.reduce((a, b) => a + b) / firstHalf.length;
      const secondHalfAvg = secondHalf.reduce((a, b) => a + b) / secondHalf.length;

      const degradation = (secondHalfAvg - firstHalfAvg) / firstHalfAvg;
      expect(degradation).toBeLessThan(0.5); // Less than 50% degradation

      console.log(`Regression test (${generations} generations): ` +
                  `Avg: ${averageTime.toFixed(2)}ms, ` +
                  `Min: ${minTime.toFixed(2)}ms, ` +
                  `Max: ${maxTime.toFixed(2)}ms, ` +
                  `Degradation: ${(degradation * 100).toFixed(1)}%`);
    });
  });
});