import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { UIGenerationService } from '../../../src/backend/services/ui-generation.js';
import { mockUIGeneration } from '../../fixtures/mock-data.js';

describe('UIGenerationService', () => {
  let uiGenerationService: UIGenerationService;
  let mockLogger: any;
  let mockFileManager: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    mockFileManager = {
      writeFile: jest.fn(),
      createTempDirectory: jest.fn(),
      cleanupTempDirectory: jest.fn(),
    };

    uiGenerationService = new UIGenerationService(mockLogger, mockFileManager);
  });

  describe('Streamlit UI Generation', () => {
    it('should generate Streamlit dashboard code', async () => {
      const requirements = {
        type: 'dashboard',
        data: { revenue: 10000, users: 500 },
        charts: ['line', 'bar'],
      };

      const result = await uiGenerationService.generateStreamlitUI(requirements);

      expect(result.type).toBe('streamlit');
      expect(result.code).toContain('import streamlit as st');
      expect(result.code).toContain('st.title');
      expect(result.renderTime).toBeLessThan(2000);
    });

    it('should validate Streamlit code syntax', async () => {
      const requirements = {
        type: 'dashboard',
        data: { metrics: [1, 2, 3, 4, 5] },
      };

      const result = await uiGenerationService.generateStreamlitUI(requirements);

      expect(result.code).toBeValidPythonCode();
      expect(result.isValid).toBe(true);
    });

    it('should handle invalid requirements gracefully', async () => {
      const invalidRequirements = {
        type: 'invalid-type',
        data: null,
      };

      await expect(
        uiGenerationService.generateStreamlitUI(invalidRequirements)
      ).rejects.toThrow('Invalid UI requirements');
    });

    it('should measure UI generation performance', async () => {
      const requirements = {
        type: 'dashboard',
        data: { large: 'dataset' },
      };

      const startTime = performance.now();
      const result = await uiGenerationService.generateStreamlitUI(requirements);
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(mockUIGeneration.streamlitDashboard.expectedRenderTime);
      expect(result.generationTime).toBeLessThan(2000);
    });
  });

  describe('Gradio UI Generation', () => {
    it('should generate Gradio interface code', async () => {
      const requirements = {
        type: 'interface',
        inputs: ['text', 'number'],
        outputs: ['text'],
        title: 'Data Analysis Tool',
      };

      const result = await uiGenerationService.generateGradioUI(requirements);

      expect(result.type).toBe('gradio');
      expect(result.code).toContain('import gradio as gr');
      expect(result.code).toContain('gr.Interface');
      expect(result.renderTime).toBeLessThan(1500);
    });

    it('should handle complex input/output configurations', async () => {
      const requirements = {
        type: 'interface',
        inputs: ['text', 'slider', 'checkbox'],
        outputs: ['text', 'image'],
        title: 'Advanced Analysis Tool',
      };

      const result = await uiGenerationService.generateGradioUI(requirements);

      expect(result.code).toContain('gr.Textbox');
      expect(result.code).toContain('gr.Slider');
      expect(result.code).toContain('gr.Checkbox');
      expect(result.isValid).toBe(true);
    });

    it('should validate Gradio code syntax', async () => {
      const requirements = {
        type: 'interface',
        inputs: ['text'],
        outputs: ['text'],
        title: 'Simple Tool',
      };

      const result = await uiGenerationService.generateGradioUI(requirements);

      expect(result.code).toBeValidPythonCode();
      expect(result.isValid).toBe(true);
    });
  });

  describe('Code Generation Utilities', () => {
    it('should sanitize user input in generated code', async () => {
      const maliciousInput = '"; DROP TABLE users; --';
      const requirements = {
        type: 'dashboard',
        data: { userInput: maliciousInput },
      };

      const result = await uiGenerationService.generateStreamlitUI(requirements);

      expect(result.code).not.toContain('DROP TABLE');
      expect(result.code).toContain(maliciousInput.replace(/['"]/g, ''));
    });

    it('should include security headers in generated code', async () => {
      const requirements = {
        type: 'dashboard',
        data: { metrics: [1, 2, 3] },
      };

      const result = await uiGenerationService.generateStreamlitUI(requirements);

      expect(result.code).toContain('# Security: Input validation enabled');
      expect(result.hasSecurityMeasures).toBe(true);
    });

    it('should handle large datasets efficiently', async () => {
      const largeDataset = Array.from({ length: 10000 }, (_, i) => ({ id: i, value: Math.random() }));
      const requirements = {
        type: 'dashboard',
        data: { largeDataset },
      };

      const result = await uiGenerationService.generateStreamlitUI(requirements);

      expect(result.code).toContain('data_chunking');
      expect(result.memoryOptimized).toBe(true);
      expect(result.generationTime).toBeLessThan(3000);
    });
  });

  describe('UI Execution', () => {
    it('should execute generated Streamlit code', async () => {
      const code = mockUIGeneration.streamlitDashboard.code;
      const executionId = 'execution-123';

      mockFileManager.createTempDirectory.mockResolvedValue('/tmp/ui-test-123');

      const result = await uiGenerationService.executeUI(code, 'streamlit', executionId);

      expect(result.executionId).toBe(executionId);
      expect(result.status).toBe('started');
      expect(result.url).toContain('localhost:8501');
    });

    it('should handle execution errors', async () => {
      const invalidCode = 'invalid python code';
      const executionId = 'execution-456';

      await expect(
        uiGenerationService.executeUI(invalidCode, 'streamlit', executionId)
      ).rejects.toThrow('UI execution failed');
    });

    it('should cleanup temporary files after execution', async () => {
      const code = mockUIGeneration.streamlitDashboard.code;
      const executionId = 'execution-789';

      mockFileManager.createTempDirectory.mockResolvedValue('/tmp/ui-test-789');
      mockFileManager.cleanupTempDirectory.mockResolvedValue(true);

      await uiGenerationService.executeUI(code, 'streamlit', executionId);

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockFileManager.cleanupTempDirectory).toHaveBeenCalledWith('/tmp/ui-test-789');
    });
  });

  describe('Performance Optimization', () => {
    it('should cache generated UI code', async () => {
      const requirements = {
        type: 'dashboard',
        data: { revenue: 10000 },
      };

      // First call
      const result1 = await uiGenerationService.generateStreamlitUI(requirements);
      // Second call with same requirements
      const result2 = await uiGenerationService.generateStreamlitUI(requirements);

      expect(result1.code).toBe(result2.code);
      expect(result2.fromCache).toBe(true);
      expect(result2.generationTime).toBeLessThan(100);
    });

    it('should optimize code for performance', async () => {
      const requirements = {
        type: 'dashboard',
        data: { heavy: 'computation' },
        optimizations: ['lazy-loading', 'memoization'],
      };

      const result = await uiGenerationService.generateStreamlitUI(requirements);

      expect(result.code).toContain('st.cache_data');
      expect(result.code).toContain('@st.cache');
      expect(result.optimizations).toContain('lazy-loading');
    });
  });
});