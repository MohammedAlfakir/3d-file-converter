/**
 * Rate limiting plugin for production protection
 */

import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

// Simple in-memory rate limiter (no Redis dependency)
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60000);

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

const defaultOptions: RateLimitOptions = {
  windowMs: 60000, // 1 minute
  maxRequests: 100, // 100 requests per minute
};

const conversionOptions: RateLimitOptions = {
  windowMs: 60000, // 1 minute
  maxRequests: 10, // 10 conversions per minute (heavy operation)
};

async function rateLimitPlugin(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    // Skip rate limiting for health checks
    if (request.url === '/health' || request.url === '/ready' || request.url === '/metrics') {
      return;
    }

    const ip = request.ip || 'unknown';
    const isConversion = request.url === '/api/convert' && request.method === 'POST';
    const options = isConversion ? conversionOptions : defaultOptions;
    const key = `${ip}:${isConversion ? 'convert' : 'general'}`;

    const now = Date.now();
    let entry = rateLimitStore.get(key);

    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + options.windowMs };
      rateLimitStore.set(key, entry);
    }

    entry.count++;

    // Add rate limit headers
    reply.header('X-RateLimit-Limit', options.maxRequests);
    reply.header('X-RateLimit-Remaining', Math.max(0, options.maxRequests - entry.count));
    reply.header('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

    if (entry.count > options.maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      reply.header('Retry-After', retryAfter);
      
      reply.status(429).send({
        error: true,
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Too many requests. Try again in ${retryAfter} seconds.`,
        retryAfter,
      });
    }
  });
}

export default fp(rateLimitPlugin, {
  name: 'rate-limit-plugin',
});
