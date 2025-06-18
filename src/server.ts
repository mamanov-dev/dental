import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import { createServer, Server as HttpServer } from 'http';

import { DatabaseService } from '@/config/database';
import { RedisService } from '@/config/redis';
import logger from '@/config/logger';

import webhookRoutes from '@/controllers/webhook';
import apiRoutes from '@/controllers/api';
import { errorHandler } from '@/middleware/errorHandler';
import { rateLimiter } from '@/middleware/rateLimiter';

// Загружаем переменные окружения
dotenv.config();

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  checks: {
    database: boolean;
    redis: boolean;
    timestamp: string;
    uptime: number;
    memory: NodeJS.MemoryUsage;
    version: string;
  };
  environment: string;
}

class Server {
  private app: express.Application;
  private httpServer: HttpServer;
  private port: number;
  private db: DatabaseService;
  private redis: RedisService;
  private isShuttingDown: boolean = false;

  constructor() {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.port = parseInt(process.env.PORT || '3000');
    this.db = DatabaseService.getInstance();
    this.redis = RedisService.getInstance();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }));

    // CORS configuration
    this.app.use(cors({
      origin: this.getCorsOrigins(),
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      credentials: true,
      maxAge: 86400 // 24 hours
    }));

    // Compression
    this.app.use(compression({
      filter: (req: express.Request, res: express.Response) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
      level: 6,
      threshold: 1024
    }));

    // Logging
    this.app.use(morgan(this.getMorganFormat(), {
      stream: { 
        write: (message: string) => logger.info(message.trim()) 
      },
      skip: (req: express.Request, res: express.Response) => {
        // Пропускаем логирование health check'ов в production
        return process.env.NODE_ENV === 'production' && req.url === '/health';
      }
    }));

    // Body parsing with size limits
    this.app.use(express.json({ 
      limit: '10mb',
      strict: true,
      type: ['application/json', 'application/*+json']
    }));
    
    this.app.use(express.urlencoded({ 
      extended: true, 
      limit: '10mb',
      parameterLimit: 100
    }));

    // Raw body для webhook'ов - ИСПРАВЛЕНО: убрали проблемный middleware
    this.app.use('/webhook', express.json({ limit: '5mb' }));

    // Rate limiting только для API routes
    this.app.use('/api/', rateLimiter);

    // Request timeout middleware
    this.app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      const timeout = parseInt(process.env.REQUEST_TIMEOUT || '30000');
      req.setTimeout(timeout, () => {
        const err = new Error('Request timeout');
        (err as any).status = 408;
        next(err);
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Root endpoint
    this.app.get('/', (req: express.Request, res: express.Response): void => {
      res.json({
        service: 'dental-bot-api',
        version: process.env.npm_package_version || '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString()
      });
    });

    // Health check endpoint
    this.app.get('/health', async (req: express.Request, res: express.Response): Promise<void> => {
      try {
        const health = await this.performHealthCheck();
        const statusCode = health.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(health);
      } catch (error) {
        logger.error('Health check failed:', error);
        res.status(503).json({
          status: 'unhealthy',
          error: 'Health check failed',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Metrics endpoint (protected)
    this.app.get('/metrics', this.requireApiKey, async (req: express.Request, res: express.Response): Promise<void> => {
      try {
        const metrics = await this.getMetrics();
        res.json(metrics);
      } catch (error) {
        logger.error('Metrics collection failed:', error);
        res.status(500).json({ error: 'Metrics collection failed' });
      }
    });

    // Ready probe для Kubernetes
    this.app.get('/ready', (req: express.Request, res: express.Response): void => {
      if (this.isShuttingDown) {
        res.status(503).json({ status: 'shutting down' });
      } else {
        res.json({ status: 'ready' });
      }
    });

    // API routes
    this.app.use('/api/v1', apiRoutes);
    
    // Webhook routes (без rate limiting для входящих сообщений)
    this.app.use('/webhook', webhookRoutes);

    // 404 handler - ИСПРАВЛЕНО: заменили app.all('*') на конкретные методы
    this.app.use((req: express.Request, res: express.Response): void => {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Endpoint not found',
          path: req.originalUrl,
          method: req.method
        },
        timestamp: new Date().toISOString()
      });
    });
  }

  private setupErrorHandling(): void {
    // Error handler должен быть последним middleware
    this.app.use(errorHandler);

    // Unhandled promise rejection
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Promise Rejection:', {
        reason,
        promise
      });
      // В production можно решить завершить процесс
      if (process.env.NODE_ENV === 'production') {
        this.gracefulShutdown();
      }
    });

    // Uncaught exception
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      this.gracefulShutdown();
    });

    // Graceful shutdown signals
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received');
      this.gracefulShutdown();
    });
    
    process.on('SIGINT', () => {
      logger.info('SIGINT received');
      this.gracefulShutdown();
    });

    // Windows specific
    if (process.platform === 'win32') {
      process.on('SIGHUP', () => {
        logger.info('SIGHUP received');
        this.gracefulShutdown();
      });
    }
  }

  private async performHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const [databaseHealth, redisHealth] = await Promise.all([
        this.checkDatabaseHealth(),
        this.checkRedisHealth()
      ]);

      const checks = {
        database: databaseHealth,
        redis: redisHealth,
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version || '1.0.0'
      };

      const allHealthy = Object.entries(checks)
        .filter(([key]) => ['database', 'redis'].includes(key))
        .every(([, value]) => value === true);

      const responseTime = Date.now() - startTime;
      logger.debug(`Health check completed in ${responseTime}ms`);

      return {
        status: allHealthy ? 'healthy' : 'unhealthy',
        checks,
        environment: process.env.NODE_ENV || 'development'
      };
    } catch (error) {
      logger.error('Health check error:', error);
      throw error;
    }
  }

  private async checkDatabaseHealth(): Promise<boolean> {
    try {
      return await this.db.healthCheck();
    } catch (error) {
      logger.error('Database health check failed:', error);
      return false;
    }
  }

  private async checkRedisHealth(): Promise<boolean> {
    try {
      return await this.redis.healthCheck();
    } catch (error) {
      logger.error('Redis health check failed:', error);
      return false;
    }
  }

  private async getMetrics(): Promise<any> {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        memory: {
          rss: memUsage.rss,
          heapTotal: memUsage.heapTotal,
          heapUsed: memUsage.heapUsed,
          external: memUsage.external
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system
        }
      },
      nodejs: {
        version: process.version,
        platform: process.platform,
        arch: process.arch
      },
      timestamp: new Date().toISOString()
    };
  }

  private requireApiKey = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const apiKey = req.header('X-API-Key');
    
    if (!apiKey || apiKey !== process.env.METRICS_API_KEY) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Valid API key required'
        }
      });
      return;
    }
    
    next();
  };

  private getCorsOrigins(): string | string[] {
    const origins = process.env.CORS_ORIGIN;
    
    if (!origins || origins === '*') {
      return '*';
    }
    
    return origins.split(',').map(origin => origin.trim());
  }

  private getMorganFormat(): string {
    return process.env.NODE_ENV === 'production' 
      ? 'combined'
      : ':method :url :status :res[content-length] - :response-time ms';
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting server initialization...');

      // Проверяем обязательные переменные окружения
      this.validateEnvironment();

      // Подключаемся к базе данных
      const dbConnected = await this.db.healthCheck();
      if (!dbConnected) {
        throw new Error('Database connection failed');
      }
      logger.info('✅ Database connection established');

      // Подключаемся к Redis
      await this.redis.connect();
      const redisConnected = await this.redis.healthCheck();
      if (!redisConnected) {
        logger.warn('⚠️  Redis connection failed, continuing without cache');
      } else {
        logger.info('✅ Redis connection established');
      }

      // Запускаем HTTP сервер
      await new Promise<void>((resolve, reject) => {
        this.httpServer.listen(this.port, '0.0.0.0', () => {
          logger.info(`🚀 Server running on port ${this.port}`);
          logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
          logger.info(`🔗 Health check: http://localhost:${this.port}/health`);
          resolve();
        });

        this.httpServer.on('error', (error: any) => {
          if (error.code === 'EADDRINUSE') {
            logger.error(`❌ Port ${this.port} is already in use`);
          } else {
            logger.error('❌ Server error:', error);
          }
          reject(error);
        });
      });

      // Настраиваем keep-alive
      this.httpServer.keepAliveTimeout = 65000;
      this.httpServer.headersTimeout = 66000;

      logger.info('🎉 Server started successfully');

    } catch (error) {
      logger.error('❌ Failed to start server:', error);
      await this.gracefulShutdown();
      process.exit(1);
    }
  }

  private validateEnvironment(): void {
    const required = [
      'DATABASE_URL',
      'JWT_SECRET'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Warn about optional but recommended variables
    const recommended = [
      'REDIS_URL',
      'API_KEY',
      'CORS_ORIGIN'
    ];

    const missingRecommended = recommended.filter(key => !process.env[key]);
    if (missingRecommended.length > 0) {
      logger.warn(`Missing recommended environment variables: ${missingRecommended.join(', ')}`);
    }
  }

  private async gracefulShutdown(): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress...');
      return;
    }

    this.isShuttingDown = true;
    logger.info('🔄 Starting graceful shutdown...');

    const shutdownTimeout = parseInt(process.env.SHUTDOWN_TIMEOUT || '10000');
    const shutdownTimer = setTimeout(() => {
      logger.error('⏰ Shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, shutdownTimeout);

    try {
      // Останавливаем прием новых соединений
      this.httpServer.close(() => {
        logger.info('🔌 HTTP server closed');
      });

      // Закрываем соединения с базами данных
      await Promise.all([
        this.db.close().catch(err => {
          logger.error('Error closing database:', err);
        }),
        this.redis.close().catch(err => {
          logger.error('Error closing Redis:', err);
        })
      ]);

      clearTimeout(shutdownTimer);
      logger.info('✅ Graceful shutdown completed');
      process.exit(0);

    } catch (error) {
      clearTimeout(shutdownTimer);
      logger.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }

  // Публичные методы для тестирования
  public getApp(): express.Application {
    return this.app;
  }

  public getHttpServer(): HttpServer {
    return this.httpServer;
  }

  public async stop(): Promise<void> {
    await this.gracefulShutdown();
  }
}

// Экспорт для тестирования
export { Server };

// Запуск сервера только если это основной модуль
if (require.main === module) {
  const server = new Server();
  server.start().catch((error) => {
    logger.error('Failed to start application:', error);
    process.exit(1);
  });
}