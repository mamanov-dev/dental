import { Request, Response, NextFunction } from 'express';
import logger from '@/config/logger';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { statusCode = 500, message, code, stack } = err;

  logger.error('Error occurred:', {
    statusCode,
    message,
    code,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    stack: process.env.NODE_ENV === 'development' ? stack : undefined
  });

  // Не выводим стек трейс в продакшене
  const response: any = {
    success: false,
    error: {
      code: code || 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' && statusCode === 500
        ? 'Internal server error'
        : message
    },
    timestamp: new Date()
  };

  if (process.env.NODE_ENV === 'development') {
    response.stack = stack;
  }

  res.status(statusCode).json(response);
};

export const asyncHandler = (fn: Function) => (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  return Promise.resolve(fn(req, res, next)).catch(next);
};

export const createError = (
  message: string,
  statusCode: number = 500,
  code?: string
): AppError => {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.code = code;
  error.isOperational = true;
  return error;
};