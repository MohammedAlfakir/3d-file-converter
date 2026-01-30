/**
 * Server Entry Point with Graceful Shutdown and Production Safeguards
 */

import path from 'path';
import fs from 'fs-extra';
import config from './config/env';
import { buildApp, stopCleanup } from './app';
import { startMemoryMonitor, stopMemoryMonitor } from './common/monitor';

let isShuttingDown = false;

async function start() {
  try {
    const app = await buildApp();

    // Start memory monitoring in production
    if (config.nodeEnv === 'production') {
      startMemoryMonitor(60000); // Log every minute
    }

    await app.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                  3D File Converter Server                         ║
╠══════════════════════════════════════════════════════════════════╣
║  Status:      RUNNING                                             ║
║  Port:        ${String(config.port).padEnd(50)}║
║  Environment: ${config.nodeEnv.padEnd(50)}║
║  Blender Max: ${String(config.maxConcurrentBlender).padEnd(50)}║
║  Assimp Max:  ${String(config.maxConcurrentAssimp).padEnd(50)}║
║  Timeout:     ${String(config.conversionTimeout / 1000) + ' seconds'.padEnd(50)}║
╠══════════════════════════════════════════════════════════════════╣
║  Endpoints:                                                       ║
║    - GET  /health           Health check                          ║
║    - GET  /ready            Readiness probe                       ║
║    - GET  /info             Server info                           ║
║    - GET  /metrics          Memory & system metrics               ║
║    - GET  /api/formats      Supported formats                     ║
║    - POST /api/convert      Convert 3D file                       ║
║    - GET  /api/download/:f  Download converted file               ║
║    - POST /api/cleanup      Trigger manual cleanup                ║
╚══════════════════════════════════════════════════════════════════╝
`);

    // ═══════════════════════════════════════════════════════════════
    // GRACEFUL SHUTDOWN
    // ═══════════════════════════════════════════════════════════════
    const shutdown = async (signal: string) => {
      if (isShuttingDown) {
        console.log('[Server] Shutdown already in progress...');
        return;
      }
      isShuttingDown = true;

      console.log(`\n[Server] ${signal} received, starting graceful shutdown...`);

      // Stop accepting new connections
      try {
        await app.close();
        console.log('[Server] HTTP server closed');
      } catch (err) {
        console.error('[Server] Error closing HTTP server:', err);
      }

      // Stop background services
      stopCleanup();
      stopMemoryMonitor();
      console.log('[Server] Background services stopped');

      // Give ongoing requests time to complete (max 5 seconds)
      console.log('[Server] Waiting for ongoing requests...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Cleanup uploads directory
      const uploadDir = path.resolve(config.uploadDir);
      try {
        const files = await fs.readdir(uploadDir);
        let cleaned = 0;
        for (const file of files) {
          if (file === '.keep' || file === '.gitkeep') continue;
          await fs.remove(path.join(uploadDir, file));
          cleaned++;
        }
        console.log(`[Server] Cleaned up ${cleaned} temporary files`);
      } catch (err) {
        console.error('[Server] Cleanup error:', err);
      }

      console.log('[Server] Shutdown complete');
      process.exit(0);
    };

    // Register shutdown handlers
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (err) => {
      console.error('[Server] Uncaught exception:', err);
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('[Server] Unhandled rejection at:', promise, 'reason:', reason);
    });

  } catch (err) {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  }
}

start();
