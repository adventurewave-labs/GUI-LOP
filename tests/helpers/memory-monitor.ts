export class MemoryMonitor {
  private isMonitoring = false;
  private startTime = 0;
  private initialMemory = 0;
  private memorySnapshots: number[] = [];
  private monitoringInterval?: NodeJS.Timeout;

  startMonitoring(intervalMs: number = 100): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    this.startTime = Date.now();
    this.initialMemory = this.getCurrentMemory();
    this.memorySnapshots = [];

    this.monitoringInterval = setInterval(() => {
      this.memorySnapshots.push(this.getCurrentMemory());
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }

  getCurrentMemory(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed;
    }

    // Fallback for browser environments
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const memory = (performance as any).memory;
      return memory.usedJSHeapSize || 0;
    }

    return 0;
  }

  getMemoryStats(): {
    initial: number;
    current: number;
    peak: number;
    average: number;
    increase: number;
    duration: number;
  } {
    const current = this.getCurrentMemory();
    const peak = Math.max(...this.memorySnapshots, current);
    const average = this.memorySnapshots.length > 0
      ? this.memorySnapshots.reduce((sum, mem) => sum + mem, 0) / this.memorySnapshots.length
      : current;

    return {
      initial: this.initialMemory,
      current,
      peak,
      average,
      increase: current - this.initialMemory,
      duration: this.isMonitoring ? Date.now() - this.startTime : 0
    };
  }

  reset(): void {
    this.stopMonitoring();
    this.memorySnapshots = [];
    this.startTime = 0;
    this.initialMemory = 0;
  }
}