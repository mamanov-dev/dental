import { Router, Request, Response } from 'express';
import { DatabaseService } from '@/config/database';
import { CreateAppointmentDto, UpdateAppointmentDto, APIResponse } from '@/types';
import { validateAppointment } from '@/middleware/validation';
import logger from '@/config/logger';

const router = Router();
const db = DatabaseService.getInstance();

// Получить все записи клиники
router.get('/', async (req: Request, res: Response) => {
  try {
    const clinicId = req.user?.clinicId;
    const { date, status, doctorId } = req.query;

    let query = `
      SELECT 
        a.*,
        p.name as patient_name,
        p.phone as patient_phone,
        d.name as doctor_name
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN doctors d ON a.doctor_id = d.id
      WHERE a.clinic_id = $1
    `;
    const params = [clinicId];
    let paramIndex = 2;

    if (date) {
      query += ` AND DATE(a.appointment_date) = $${paramIndex}`;
      params.push(date as string);
      paramIndex++;
    }

    if (status) {
      query += ` AND a.status = $${paramIndex}`;
      params.push(status as string);
      paramIndex++;
    }

    if (doctorId) {
      query += ` AND a.doctor_id = $${paramIndex}`;
      params.push(parseInt(doctorId as string));
      paramIndex++;
    }

    query += ` ORDER BY a.appointment_date ASC`;

    const result = await db.query(query, params);

    const response: APIResponse = {
      success: true,
      data: result.rows,
      timestamp: new Date()
    };

    res.json(response);
  } catch (error) {
    logger.error('Error fetching appointments:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ERROR',
        message: 'Failed to fetch appointments'
      },
      timestamp: new Date()
    });
  }
});

// Получить конкретную запись
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const clinicId = req.user?.clinicId;

    const result = await db.queryOne(`
      SELECT 
        a.*,
        p.name as patient_name,
        p.phone as patient_phone,
        d.name as doctor_name,
        d.specialization as doctor_specialization
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN doctors d ON a.doctor_id = d.id
      WHERE a.id = $1 AND a.clinic_id = $2
    `, [appointmentId, clinicId]);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Appointment not found'
        },
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      data: result,
      timestamp: new Date()
    });
  } catch (error) {
    logger.error('Error fetching appointment:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ERROR',
        message: 'Failed to fetch appointment'
      },
      timestamp: new Date()
    });
  }
});

// Создать новую запись
router.post('/', validateAppointment, async (req: Request, res: Response) => {
  try {
    const appointmentData: CreateAppointmentDto = req.body;
    const clinicId = req.user?.clinicId;

    // Проверяем, что врач принадлежит клинике
    const doctor = await db.queryOne(`
      SELECT id FROM doctors 
      WHERE id = $1 AND clinic_id = $2 AND is_active = true
    `, [appointmentData.doctorId, clinicId]);

    if (!doctor) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_DOCTOR',
          message: 'Doctor not found or not available'
        },
        timestamp: new Date()
      });
    }

    // Находим или создаем пациента
    let patient = await db.queryOne(`
      SELECT id FROM patients WHERE phone = $1
    `, [appointmentData.patientPhone]);

    if (!patient) {
      const patientResult = await db.query(`
        INSERT INTO patients (phone, name, platform)
        VALUES ($1, $2, 'api')
        RETURNING id
      `, [appointmentData.patientPhone, appointmentData.patientName]);
      patient = patientResult.rows[0];
    }

    // Создаем запись
    const result = await db.query(`
      INSERT INTO appointments (
        clinic_id, doctor_id, patient_id, appointment_date,
        service_type, notes, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
      RETURNING *
    `, [
      clinicId,
      appointmentData.doctorId,
      patient.id,
      appointmentData.appointmentDate,
      appointmentData.serviceType,
      appointmentData.notes
    ]);

    logger.info('Appointment created', { 
      appointmentId: result.rows[0].id,
      clinicId,
      patientPhone: appointmentData.patientPhone
    });

    res.status(201).json({
      success: true,
      data: result.rows[0],
      timestamp: new Date()
    });
  } catch (error) {
    logger.error('Error creating appointment:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CREATE_ERROR',
        message: 'Failed to create appointment'
      },
      timestamp: new Date()
    });
  }
});

// Обновить запись
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const updateData: UpdateAppointmentDto = req.body;
    const clinicId = req.user?.clinicId;

    // Проверяем, что запись существует и принадлежит клинике
    const existing = await db.queryOne(`
      SELECT id FROM appointments 
      WHERE id = $1 AND clinic_id = $2
    `, [appointmentId, clinicId]);

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Appointment not found'
        },
        timestamp: new Date()
      });
    }

    // Формируем запрос обновления
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (updateData.appointmentDate) {
      updates.push(`appointment_date = $${paramIndex}`);
      params.push(updateData.appointmentDate);
      paramIndex++;
    }

    if (updateData.doctorId) {
      updates.push(`doctor_id = $${paramIndex}`);
      params.push(updateData.doctorId);
      paramIndex++;
    }

    if (updateData.serviceType) {
      updates.push(`service_type = $${paramIndex}`);
      params.push(updateData.serviceType);
      paramIndex++;
    }

    if (updateData.notes !== undefined) {
      updates.push(`notes = $${paramIndex}`);
      params.push(updateData.notes);
      paramIndex++;
    }

    if (updateData.status) {
      updates.push(`status = $${paramIndex}`);
      params.push(updateData.status);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_UPDATES',
          message: 'No updates provided'
        },
        timestamp: new Date()
      });
    }

    updates.push(`updated_at = NOW()`);
    params.push(appointmentId);

    const query = `
      UPDATE appointments 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await db.query(query, params);

    logger.info('Appointment updated', { 
      appointmentId,
      updates: Object.keys(updateData)
    });

    res.json({
      success: true,
      data: result.rows[0],
      timestamp: new Date()
    });
  } catch (error) {
    logger.error('Error updating appointment:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_ERROR',
        message: 'Failed to update appointment'
      },
      timestamp: new Date()
    });
  }
});

// Отменить запись
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const clinicId = req.user?.clinicId;

    const result = await db.query(`
      UPDATE appointments 
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND clinic_id = $2
      RETURNING *
    `, [appointmentId, clinicId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Appointment not found'
        },
        timestamp: new Date()
      });
    }

    logger.info('Appointment cancelled', { appointmentId });

    res.json({
      success: true,
      data: result.rows[0],
      timestamp: new Date()
    });
  } catch (error) {
    logger.error('Error cancelling appointment:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CANCEL_ERROR',
        message: 'Failed to cancel appointment'
      },
      timestamp: new Date()
    });
  }
});

export default router;