/**
 * Health check routes with memory monitoring
 */

import { FastifyInstance } from 'fastify';
import { 
  isBlenderAvailable, 
  getBlenderVersion 
} from '../conversion/providers/blender.provider';
import { 
  isAssimpAvailable, 
  getAssimpVersion 
} from '../conversion/providers/assimp.provider';
import { 
  isOdaAvailable, 
  getOdaVersion 
} from '../conversion/providers/oda.provider';
import { getMemoryStats, isMemoryCritical } from '../../common/monitor';

export async function healthRoutes(fastify: FastifyInstance) {
  /**
   * GET /health - Basic health check (always returns ok if server is running)
   */
  fastify.get('/health', async () => {
    return { 
      status: 'ok', 
      timestamp: new Date().toISOString() 
    };
  });

  /**
   * GET /ready - Detailed readiness check with tool availability
   */
  fastify.get('/ready', async () => {
    const [blender, assimp, oda] = await Promise.all([
      isBlenderAvailable(),
      isAssimpAvailable(),
      isOdaAvailable(),
    ]);

    const memory = getMemoryStats();
    const memoryOk = !isMemoryCritical();

    // Core tools must be available and memory must be OK
    const isReady = blender && assimp && memoryOk;
    
    return {
      status: isReady ? 'ready' : 'degraded',
      checks: {
        blender: blender ? 'ok' : 'unavailable',
        assimp: assimp ? 'ok' : 'unavailable',
        oda: oda ? 'ok' : 'unavailable', // ODA is optional (only for DWG)
        memory: memoryOk ? 'ok' : 'critical',
      },
      memory: {
        heapUsedMB: memory.heapUsedMB,
        rssMB: memory.rssMB,
        systemPercent: memory.percentUsed,
      },
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * GET /info - Server information and tool versions
   */
  fastify.get('/info', async () => {
    const [blenderVersion, assimpVersion, odaVersion] = await Promise.all([
      getBlenderVersion(),
      getAssimpVersion(),
      getOdaVersion(),
    ]);

    return {
      server: {
        name: '3D File Converter',
        version: '1.0.0',
        node: process.version,
        environment: process.env.NODE_ENV || 'development',
      },
      tools: {
        blender: blenderVersion || 'not available',
        assimp: assimpVersion || 'not available',
        oda: odaVersion || 'not available',
      },
      formats: {
        input: ['obj', 'fbx', 'gltf', 'glb', 'dxf', 'dwg'],
        output: ['obj', 'fbx', 'gltf', 'glb', 'dxf', 'dwg'],
      },
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * GET /metrics - Detailed server metrics (for monitoring systems)
   */
  fastify.get('/metrics', async () => {
    const memory = getMemoryStats();
    
    return {
      uptime: Math.round(process.uptime()),
      memory,
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      timestamp: new Date().toISOString(),
    };
  });
}
