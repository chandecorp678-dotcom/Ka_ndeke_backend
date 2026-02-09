'use strict';

const logger = require('./logger');

/**
 * Simple in-memory rate limiter for IP-based and user-based throttling.
 * Usage: Pass to Express middleware or call directly.
 * 
 * Tracks requests by key (IP, user ID, etc.) and enforces max requests per window.
 * Automatically prunes old entries to prevent memory bloat.
 */

class RateLimiter {
  constructor(opts = {}) {
    this.maxRequests = opts.maxRequests || 5; // max requests per window
    this.windowMs = opts.windowMs || 60000; // time window (ms)
    this.pruneIntervalMs = opts.pruneIntervalMs || 300000; // prune every 5 min
    this.store = new Map(); // { key: { count, resetAt } }
    this._startPrune();
  }

  _startPrune() {
    if (this.pruneTimer) return;
    try {
      this.pruneTimer = setInterval(() => this.prune(), this.pruneIntervalMs);
      if (typeof this.pruneTimer.unref === 'function') this.pruneTimer.unref();
    } catch (e) {
      logger.warn('rateLimiter.prune_start_failed', { message: e && e.message ? e.message : String(e) });
    }
  }

  /**
   * Check if a request is allowed for a given key.
   * Returns { allowed: true/false, remaining: number, resetAt: timestamp }
   */
  check(key) {
    if (!key) return { allowed: false, remaining: 0, resetAt: null };

    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || now >= entry.resetAt) {
      // Window expired or first request
      entry = { count: 1, resetAt: now + this.windowMs };
      this.store.set(key, entry);
      return { allowed: true, remaining: this.maxRequests - 1, resetAt: entry.resetAt };
    }

    // Still within window
    if (entry.count < this.maxRequests) {
      entry.count++;
      return { allowed: true, remaining: this.maxRequests - entry.count, resetAt: entry.resetAt };
    }

    // Rate limit exceeded
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  /**
   * Reset a specific key (useful for admin override).
   */
  reset(key) {
    this.store.delete(key);
  }

  /**
   * Clear all entries (useful for testing).
   */
  clear() {
    this.store.clear();
  }

  /**
   * Prune expired entries.
   */
  prune() {
    try {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (now >= entry.resetAt) {
          this.store.delete(key);
        }
      }
    } catch (e) {
      logger.warn('rateLimiter.prune_failed', { message: e && e.message ? e.message : String(e) });
    }
  }

  /**
   * Express middleware wrapper.
   * Usage: app.post('/login', createMiddleware(loginLimiter), loginHandler)
   */
  middleware(opts = {}) {
    const keyFn = opts.keyFn || ((req) => req.ip);
    const onLimitExceeded = opts.onLimitExceeded || ((req, res) => {
      res.status(429).json({ error: 'Too many requests, please try again later' });
    });

    return (req, res, next) => {
      const key = keyFn(req);
      const result = this.check(key);

      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));
      if (result.resetAt) {
        res.setHeader('X-RateLimit-Reset', result.resetAt);
      }

      if (!result.allowed) {
        logger.warn('rateLimiter.limit_exceeded', { key, maxRequests: this.maxRequests, windowMs: this.windowMs });
        return onLimitExceeded(req, res);
      }

      next();
    };
  }

  /**
   * Shutdown/cleanup.
   */
  destroy() {
    try {
      if (this.pruneTimer) {
        clearInterval(this.pruneTimer);
        this.pruneTimer = null;
      }
      this.store.clear();
    } catch (e) {
      logger.warn('rateLimiter.destroy_failed', { message: e && e.message ? e.message : String(e) });
    }
  }
}

module.exports = RateLimiter;
