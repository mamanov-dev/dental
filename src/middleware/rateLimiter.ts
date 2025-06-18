import { Request, Response, NextFunction } from 'express';
import { RedisService } from '@/config/redis';
import logger from '@/config/logger';

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
}

const defaultOptions: RateLimitOptions = {
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'), // 1 minute
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100')
};

export const rateLimiter = createRateLimiter(defaultOptions);

export function createRateLimiter(options: RateLimitOptions) {
  const redis = RedisService.getInstance();
  
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = options.keyGenerator ? 
        options.keyGenerator(req) : 
        `rate_limit:${req.ip}`;

      const current = await redis.incr(key);
      
      if (current === 1) {
        await redis.expire(key, Math.ceil(options.windowMs / 1000));
      }

      // Добавляем заголовки с информацией о лимитах
      res.set({
        'X-RateLimit-Limit': options.maxRequests.toString(),
        'X-RateLimit-Remaining': Math.max(0, options.maxRequests - current).toString(),
        'X-RateLimit-Reset': new Date(Date.now() + options.windowMs).toISOString()
      });

      if (current > options.maxRequests) {
        logger.warn('Rate limit exceeded', { 
          ip: req.ip, 
          path: req.path,
          current 
        });

        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests. Please try again later.',
            retryAfter: Math.ceil(options.windowMs / 1000)
          }
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('Rate limiter error:', error);
      // В случае ошибки Redis пропускаем запрос
      next();
    }
  };
}