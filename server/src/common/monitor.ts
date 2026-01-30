/**
 * Memory and resource monitoring utilities
 */

import os from 'os';

export interface MemoryStats {
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  freeMemoryMB: number;
  totalMemoryMB: number;
  percentUsed: number;
}

/**
 * Get current memory statistics
 */
export function getMemoryStats(): MemoryStats {
  const mem = process.memoryUsage();
  const freeMemory = os.freemem();
  const totalMemory = os.totalmem();

  return {
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    rssMB: Math.round(mem.rss / 1024 / 1024),
    externalMB: Math.round(mem.external / 1024 / 1024),
    freeMemoryMB: Math.round(freeMemory / 1024 / 1024),
    totalMemoryMB: Math.round(totalMemory / 1024 / 1024),
    percentUsed: Math.round((1 - freeMemory / totalMemory) * 100)
  };
}

/**
 * Check if memory usage is critical (> 90%)
 */
export function isMemoryCritical(): boolean {
  const stats = getMemoryStats();
  return stats.percentUsed > 90;
}

/**
 * Check if memory usage is warning level (> 80%)
 */
export function isMemoryWarning(): boolean {
  const stats = getMemoryStats();
  return stats.percentUsed > 80;
}

let monitorInterval: NodeJS.Timeout | null = null;

/**
 * Start periodic memory monitoring
 */
export function startMemoryMonitor(intervalMs: number = 60000): NodeJS.Timeout {
  console.log(`[Monitor] Starting memory monitor (interval: ${intervalMs / 1000}s)`);

  monitorInterval = setInterval(() => {
    const stats = getMemoryStats();
    
    // Log current memory stats
    const logMessage = `[Monitor] Memory: Heap ${stats.heapUsedMB}/${stats.heapTotalMB}MB | RSS ${stats.rssMB}MB | System ${stats.percentUsed}% used`;
    
    if (stats.percentUsed > 90) {
      console.error(`🔴 CRITICAL ${logMessage}`);
    } else if (stats.percentUsed > 80) {
      console.warn(`🟡 WARNING ${logMessage}`);
    } else {
      console.log(logMessage);
    }
  }, intervalMs);

  return monitorInterval;
}

/**
 * Stop memory monitoring
 */
export function stopMemoryMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('[Monitor] Memory monitor stopped');
  }
}
