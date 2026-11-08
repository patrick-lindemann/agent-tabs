import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * Limits how many requests a client can send to a route. Routes pass their
 * own limits; the defaults come from the server configuration.
 */
export function limitRequests(route: string): RequestHandler {
  const limits = config.rateLimit.routes[route] ?? config.rateLimit;

  const limiter = rateLimit({
    windowMs: limits.window,
    max: limits.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (request) => request.ip ?? 'unknown',
    message: { error: 'Too many requests, try again later.' }
  });

  return limiter;
}
