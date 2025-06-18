import { createClient, RedisClientType } from 'redis';
import logger from './logger';

export class RedisService {
  private client: RedisClientType;
  private static instance: RedisService;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://redis:6379',
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            logger.error('Redis retry attempts exhausted');
            return new Error('Retry attempts exhausted');
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    this.setupEventListeners();
  }

  public static getInstance(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService();
    }
    return RedisService.instance;
  }

  private setupEventListeners(): void {
    this.client.on('connect', () => {
      logger.info('Redis client connected');
    });

    this.client.on('error', (err) => {
      logger.error('Redis client error:', err);
    });

    this.client.on('ready', () => {
      logger.info('Redis client ready');
    });
  }

  async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  async set(key: string, value: string, expireInSeconds?: number): Promise<void> {
    await this.connect();
    if (expireInSeconds) {
      await this.client.setEx(key, expireInSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    await this.connect();
    return await this.client.get(key);
  }

  async del(key: string): Promise<number> {
    await this.connect();
    return await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    await this.connect();
    const result = await this.client.exists(key);
    return result === 1;
  }

  async incr(key: string): Promise<number> {
    await this.connect();
    return await this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    await this.connect();
    const result = await this.client.expire(key, seconds);
    return result === 1;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.connect();
      await this.client.ping();
      return true;
    } catch (error) {
      logger.error('Redis health check failed:', error);
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }
}