import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';

import { DatabaseService } from '@/config/database';
import { RedisService } from '@/config/redis';
import logger from '@/config/logger';

import webhookRoutes from '@/controllers/webhook';
import apiRoutes from '@/controllers/api';
import { errorHandler } from '@/middleware/errorHandler';
import { rateLimiter } from '@/middleware/rateLimiter';

// Загружаем переменные окружения
dotenv.config();

class Server {
  private app: express.Application;
  private port: number;
  private db: DatabaseService;
  private redis: RedisService;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3000');
    this.db = DatabaseService.getInstance();
    this.redis = RedisService.getInstance();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet());
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
    }));

    // Compression
    this.app.use(compression());

    // Logging
    this.app.use(morgan('combined', {
      stream: { write: message => logger.info(message.trim()) }
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Rate limiting
    this.app.use('/api/', rateLimiter);
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', async (req, res) => {
      const health = await this.performHealthCheck();
      res.status(health.status === 'healthy' ? 200 : 503).json(health);
    });

    // API routes
    this.app.use('/api/v1', apiRoutes);
    
    // Webhook routes (без rate limiting для входящих сообщений)
    this.app.use('/webhook', webhookRoutes);

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Endpoint not found'
        }
      });
    });
  }

  private setupErrorHandling(): void {
    this.app.use(errorHandler);

    // Graceful shutdown
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());
  }

  private async performHealthCheck(): Promise<any> {
    const checks = {
      database: await this.db.healthCheck(),
      redis: await this.redis.healthCheck(),
      timestamp: new Date().toISOString()
    };

    const allHealthy = Object.values(checks).every(check => 
      typeof check === 'boolean' ? check : true
    );

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      checks
    };
  }

  async start(): Promise<void> {
    try {
      // Подключаемся к базе данных
      await this.db.healthCheck();
      logger.info('Database connection established');

      // Подключаемся к Redis
      await this.redis.connect();
      logger.info('Redis connection established');

      // Запускаем сервер
      this.app.listen(this.port, () => {
        logger.info(`Server running on port ${this.port}`);
        logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      });

    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  private async gracefulShutdown(): Promise<void> {
    logger.info('Received shutdown signal, starting graceful shutdown...');

    try {
      await this.db.close();
      await this.redis.close();
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Запуск сервера
const server = new Server();
server.start();
