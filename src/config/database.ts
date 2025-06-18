import { Pool, PoolClient, QueryResult as PgQueryResult, QueryResultRow } from 'pg';
import logger from './logger';

// Локальные интерфейсы для DatabaseService
interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  maxConnections?: number;
}

interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  command: string;
}

interface Transaction {
  query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<PgQueryResult<T>>;
  commit(): Promise<PgQueryResult>;
  rollback(): Promise<PgQueryResult>;
}

export class DatabaseService {
  private pool: Pool;
  private static instance: DatabaseService;

  constructor(config?: DatabaseConfig) {
    const dbConfig = config || this.getConfigFromEnv();
    
    this.pool = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.username,
      password: dbConfig.password,
      ssl: dbConfig.ssl ? { rejectUnauthorized: false } : false,
      max: dbConfig.maxConnections || 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.setupEventListeners();
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  private getConfigFromEnv(): DatabaseConfig {
    const url = process.env.DATABASE_URL;
    if (url) {
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parseInt(parsed.port) || 5432,
        database: parsed.pathname.slice(1),
        username: parsed.username,
        password: parsed.password,
        ssl: process.env.NODE_ENV === 'production',
      };
    }

    return {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'dental_bot',
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
      ssl: process.env.NODE_ENV === 'production',
    };
  }

  private setupEventListeners(): void {
    this.pool.on('connect', () => {
      logger.info('New database connection established');
    });

    this.pool.on('error', (err) => {
      logger.error('Database connection error:', err);
    });
  }

  async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now();
    const client = await this.pool.connect();
    
    try {
      const result = await client.query<T>(text, params);
      const duration = Date.now() - start;
      
      logger.debug('Executed query', { 
        text: text.substring(0, 100), 
        duration, 
        rows: result.rowCount 
      });
      
      return {
        rows: result.rows,
        rowCount: result.rowCount || 0,
        command: result.command
      };
    } catch (error) {
      logger.error('Database query error:', { text, params, error });
      throw error;
    } finally {
      client.release();
    }
  }

  async queryOne<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] || null;
  }

  async transaction<T>(callback: (trx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const transaction: Transaction = {
        query: <U extends QueryResultRow = any>(text: string, params?: any[]) => client.query<U>(text, params),
        commit: () => client.query('COMMIT'),
        rollback: () => client.query('ROLLBACK'),
      };

      const result = await callback(transaction);
      await client.query('COMMIT');
      
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Transaction error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch (error) {
      logger.error('Database health check failed:', error);
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database connection pool closed');
  }
}

// Экспортируем типы для использования в других модулях
export type { DatabaseConfig, QueryResult, Transaction };