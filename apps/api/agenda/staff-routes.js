import { uuidPattern } from '../auth/credentials.js';
import { uuidParams } from '../auth/staff-web.js';
import { createAppointment, deleteAppointment, listAppointments, listAppointmentStudents, updateAppointment } from './appointments.js';
import { createEvent, deleteEvent, listStaffEvents, readEvent, updateEvent } from './events.js';
import { agendaPeriod, agendaQuerySchema } from './period.js';

function requireEvent(body) {
  const event = readEvent(body);
  if (!event) throw Object.assign(new Error('Événement non valide.'), { statusCode: 400 });
  return event;
}

function requirePeriod(query) {
  const period = agendaPeriod(query);
  if (!period) throw Object.assign(new Error('Période non valide.'), { statusCode: 400 });
  return period;
}

export function registerStaffAgenda(app, prefix, authenticated, canAccessClass) {
  function scopeRoute(operation, status) {
    return authenticated(async (request, db, actor) => {
      const classId = request.params?.classId ?? null;
      if (canAccessClass && (!classId || !await canAccessClass(db, actor, classId))) return null;
      if (classId) {
        const current = await db.query('SELECT 1 FROM classes WHERE school_id = $1 AND id = $2 FOR SHARE',
          [actor.school_id, classId]);
        if (!current.rowCount) return null;
      }
      return operation(request, db, actor, classId);
    }, status);
  }

  function register(url, ids) {
    const params = ids.length ? { params: uuidParams(...ids) } : {};
    const itemParams = uuidParams(...ids, 'eventId');
    app.get(url, { schema: { ...params, querystring: agendaQuerySchema } },
      scopeRoute((request, db, actor, classId) => listStaffEvents(db, actor.school_id, classId, requirePeriod(request.query))));

    app.post(url, { bodyLimit: 32 * 1024, schema: params },
      scopeRoute(async (request, db, actor, classId) => {
        const id = await createEvent(db, actor.school_id, classId, requireEvent(request.body));
        return id ? { id } : null;
      }, 201));

    app.put(url + '/:eventId', { bodyLimit: 32 * 1024, schema: { params: itemParams } },
      scopeRoute(async (request, db, actor, classId) => {
        const updated = await updateEvent(db, actor.school_id, classId, request.params.eventId, requireEvent(request.body));
        return updated ? undefined : null;
      }, 204));

    app.delete(url + '/:eventId', { schema: { params: itemParams } },
      scopeRoute(async (request, db, actor, classId) => {
        const removed = await deleteEvent(db, actor.school_id, classId, request.params.eventId);
        return removed ? undefined : null;
      }, 204));
  }

  register(prefix + '/classes/:classId/agenda', ['classId']);
  if (!canAccessClass) register(prefix + '/agenda', []);

  const appointments = prefix + '/classes/:classId/appointments';
  const classParams = uuidParams('classId');
  const itemParams = uuidParams('classId', 'eventId');
  const reference = { type: 'string', pattern: uuidPattern.source };
  app.get(appointments + '/students', { schema: { params: classParams } },
    scopeRoute(async (_request, db, actor, classId) => ({ students: await listAppointmentStudents(db, actor.school_id, classId) })));

  app.get(appointments, { schema: { params: classParams, querystring: agendaQuerySchema } },
    scopeRoute((request, db, actor, classId) => listAppointments(db, actor, classId, requirePeriod(request.query))));

  app.post(appointments, {
    bodyLimit: 32 * 1024,
    schema: {
      params: classParams,
      body: {
        type: 'object', required: ['studentId', 'guardianReference', 'event'], additionalProperties: false,
        properties: { studentId: reference, guardianReference: reference, event: { type: 'object' } },
      },
    },
  }, scopeRoute(async (request, db, actor, classId) => {
    const id = await createAppointment(db, actor, classId, request.body, requireEvent(request.body.event));
    return id ? { id } : null;
  }, 201));

  app.put(appointments + '/:eventId', { bodyLimit: 32 * 1024, schema: { params: itemParams } },
    scopeRoute(async (request, db, actor, classId) => {
      const updated = await updateAppointment(db, actor, classId, request.params.eventId, requireEvent(request.body));
      return updated ? undefined : null;
    }, 204));

  app.delete(appointments + '/:eventId', { schema: { params: itemParams } },
    scopeRoute(async (request, db, actor, classId) => {
      const removed = await deleteAppointment(db, actor, classId, request.params.eventId);
      return removed ? undefined : null;
    }, 204));
}
