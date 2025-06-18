import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { DatabaseService } from '@/config/database';
import logger from '@/config/logger';

interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    clinicId: number;
    role: string;
  };
}

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    const apiKey = req.header('X-API-Key');

    if (!token && !apiKey) {
      res.status(401).json({
        success: false,
        error: {
          code: 'NO_AUTH',
          message: 'No authentication provided'
        }
      });
      return;
    }

    if (apiKey) {
      // API Key authentication
      const user = await authenticateApiKey(apiKey);
      if (user) {
        req.user = user;
        next();
        return;
      }
    }

    if (token) {
      // JWT authentication
      const user = await authenticateJWT(token);
      if (user) {
        req.user = user;
        next();
        return;
      }
    }

    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_AUTH',
        message: 'Invalid authentication credentials'
      }
    });
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication service error'
      }
    });
  }
};

async function authenticateApiKey(apiKey: string): Promise<any> {
  const db = DatabaseService.getInstance();
  
  // В MVP для простоты используем статичный API ключ
  // В продакшене нужна таблица api_keys с ротацией ключей
  if (apiKey === process.env.API_KEY) {
    // Возвращаем дефолтную клинику
    const clinic = await db.queryOne(`
      SELECT id FROM clinics WHERE is_active = true LIMIT 1
    `);
    
    if (clinic) {
      return {
        id: 1,
        clinicId: clinic.id,
        role: 'admin'
      };
    }
  }
  
  return null;
}

async function authenticateJWT(token: string): Promise<any> {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    // Проверяем, что пользователь все еще активен
    const db = DatabaseService.getInstance();
    const user = await db.queryOne(`
      SELECT id, clinic_id, role FROM clinic_users 
      WHERE id = $1 AND is_active = true
    `, [decoded.userId]);
    
    return user ? {
      id: user.id,
      clinicId: user.clinic_id,
      role: user.role
    } : null;
  } catch (error) {
    return null;
  }
}