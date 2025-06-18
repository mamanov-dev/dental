import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { createError } from './errorHandler';

// Схемы валидации
const appointmentSchema = Joi.object({
  doctorId: Joi.number().integer().positive().required(),
  patientPhone: Joi.string().pattern(/^\+?[7-8][\d\s\-\(\)]{10,}$/).required(),
  patientName: Joi.string().min(2).max(100).optional(),
  appointmentDate: Joi.date().min('now').required(),
  serviceType: Joi.string().max(100).optional(),
  notes: Joi.string().max(500).optional()
});

const clinicSchema = Joi.object({
  name: Joi.string().min(2).max(255).required(),
  phone: Joi.string().pattern(/^\+?[7-8][\d\s\-\(\)]{10,}$/).optional(),
  address: Joi.string().max(500).optional(),
  timezone: Joi.string().max(50).optional(),
  settings: Joi.object().optional()
});

const patientSchema = Joi.object({
  phone: Joi.string().pattern(/^\+?[7-8][\d\s\-\(\)]{10,}$/).required(),
  name: Joi.string().min(2).max(100).optional(),
  preferredLanguage: Joi.string().valid('ru', 'kz', 'en').optional(),
  platform: Joi.string().valid('whatsapp', 'telegram', 'web', 'api').optional()
});

export const validateAppointment = createValidator(appointmentSchema);
export const validateClinic = createValidator(clinicSchema);
export const validatePatient = createValidator(patientSchema);

function createValidator(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const details = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details
        },
        timestamp: new Date()
      });
      return;
    }

    req.body = value;
    next();
  };
}