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

    // ДОБАВЛЕНО: Детальное логирование
    console.log('🔍 Auth middleware called for:', req.method, req.path);
    console.log('🔍 Has token:', !!token);
    console.log('🔍 Has API key:', !!apiKey);
    console.log('🔍 API key value:', apiKey);

    if (!token && !apiKey) {
      console.log('❌ No authentication provided');
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
      console.log('🔑 Trying API key authentication...');
      // API Key authentication
      const user = await authenticateApiKey(apiKey);
      console.log('🔑 API key auth result:', user);
      
      if (user) {
        req.user = user;
        console.log('✅ API key authentication successful');
        next();
        return;
      } else {
        console.log('❌ API key authentication failed');
      }
    }

    if (token) {
      console.log('🎫 Trying JWT authentication...');
      // JWT authentication
      const user = await authenticateJWT(token);
      console.log('🎫 JWT auth result:', user);
      
      if (user) {
        req.user = user;
        console.log('✅ JWT authentication successful');
        next();
        return;
      } else {
        console.log('❌ JWT authentication failed');
      }
    }

    console.log('❌ All authentication methods failed');
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_AUTH',
        message: 'Invalid authentication credentials'
      }
    });
  } catch (error) {
    console.log('💥 Auth middleware error:', error);
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
  console.log('🔑 Starting authenticateApiKey');
  console.log('🔑 Received API key:', apiKey);
  console.log('🔑 Expected API key from env:', process.env.API_KEY);
  console.log('🔑 Keys match:', apiKey === process.env.API_KEY);
  
  try {
    const db = DatabaseService.getInstance();
    console.log('🗄️ Database service instance created');
    
    // В MVP для простоты используем статичный API ключ
    // В продакшене нужна таблица api_keys с ротацией ключей
    if (apiKey === process.env.API_KEY) {
      console.log('✅ API key matches, querying database...');
      
      try {
        // Возвращаем дефолтную клинику
        const clinic = await db.queryOne(`
          SELECT id FROM clinics WHERE is_active = true LIMIT 1
        `);
        
        console.log('🏥 Database query result:', clinic);
        
        if (clinic) {
          const user = {
            id: 1,
            clinicId: clinic.id,
            role: 'admin'
          };
          console.log('✅ Creating user object:', user);
          return user;
        } else {
          console.log('❌ No active clinic found in database');
          
          // FALLBACK: Попробуем найти любую клинику
          console.log('🔄 Trying to find any clinic...');
          const anyClinic = await db.queryOne(`SELECT id FROM clinics LIMIT 1`);
          console.log('🏥 Any clinic query result:', anyClinic);
          
          if (anyClinic) {
            const user = {
              id: 1,
              clinicId: anyClinic.id,
              role: 'admin'
            };
            console.log('✅ Using fallback clinic, creating user:', user);
            return user;
          } else {
            console.log('❌ No clinics found at all');
          }
        }
      } catch (dbError) {
        console.log('💥 Database query error:', dbError);
        
        // ПОСЛЕДНИЙ FALLBACK: Создаем тестового пользователя
        console.log('🆘 Using emergency fallback user');
        return {
          id: 1,
          clinicId: 1,
          role: 'admin'
        };
      }
    } else {
      console.log('❌ API key does not match environment variable');
    }
  } catch (error) {
    console.log('💥 General error in authenticateApiKey:', error);
  }
  
  console.log('❌ Returning null from authenticateApiKey');
  return null;
}

async function authenticateJWT(token: string): Promise<any> {
  console.log('🎫 Starting JWT authentication');
  console.log('🎫 Token:', token?.substring(0, 20) + '...');
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    console.log('🎫 JWT decoded successfully:', decoded);
    
    // Проверяем, что пользователь все еще активен
    const db = DatabaseService.getInstance();
    const user = await db.queryOne(`
      SELECT id, clinic_id, role FROM clinic_users 
      WHERE id = $1 AND is_active = true
    `, [decoded.userId]);
    
    console.log('🎫 User lookup result:', user);
    
    return user ? {
      id: user.id,
      clinicId: user.clinic_id,
      role: user.role
    } : null;
  } catch (error) {
    console.log('💥 JWT authentication error:', error);
    return null;
  }
}