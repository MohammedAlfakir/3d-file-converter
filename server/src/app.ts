/**
 * Fastify Application Setup with Production Safeguards
 */

import path from 'path';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';

import config from './config/env';
import { AppError } from './common/errors';
import { conversionRoutes } from './modules/conversion';
import { healthRoutes } from './modules/health';
import { ensureUploadDir, startCleanupJob } from './modules/files';
import { rateLimitPlugin } from './plugins';

let cleanupInterval: NodeJS.Timeout | null = null;

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.nodeEnv !== 'production' ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      } : undefined, // Use JSON logging in production
    },
    bodyLimit: config.maxFileSize,
    // Timeouts
    connectionTimeout: config.conversionTimeout + 30000, // Give buffer for response
    requestTimeout: config.conversionTimeout,
  });

  // Register rate limiting plugin (production protection)
  await app.register(rateLimitPlugin);

  // Register plugins
  await app.register(cors, {
    origin: true, // Allow all origins (configure for production)
    methods: ['GET', 'POST', 'DELETE'],
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.maxFileSize,
      files: 1,
    },
  });

  // Serve converted files statically
  await app.register(fastifyStatic, {
    root: path.resolve(config.uploadDir),
    prefix: '/files/',
    decorateReply: false, // Avoid collision with download route
  });

  // Global error handler
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    const message = error.message || 'Internal Server Error';

    app.log.error({
      err: error,
      statusCode,
      message,
    });

    reply.status(statusCode).send({
      error: true,
      message,
      code: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
    });
  });

  // Not found handler
  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      error: true,
      message: 'Not Found',
      code: 'NOT_FOUND',
    });
  });

  // Register routes
  await app.register(healthRoutes, { prefix: '' });
  await app.register(conversionRoutes, { prefix: '/api' });

  // Root redirect
  app.get('/', async (_request, reply) => {
    reply.redirect('/health');
  });

  // Ensure upload directory exists
  await ensureUploadDir();

  // Start cleanup job
  cleanupInterval = startCleanupJob();

  return app;
}

export function stopCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
