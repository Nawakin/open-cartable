import { uuidParams } from '../auth/staff-web.js';
import { createEvent, deleteEvent, listStaffEvents, readEvent, updateEvent } from './events.js';
import { agendaPeriod, agendaQuerySchema } from './period.js';

function requireEvent(body) {
  const event = readEvent(body);
  if (!event) throw Object.assign(new Error('Événement non valide.'), { statusCode: 400 });
  return event;
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
      return operation(request, db, actor.school_id, classId);
    }, status);
  }

  function register(url, ids) {
    const params = ids.length ? { params: uuidParams(...ids) } : {};
    const itemParams = uuidParams(...ids, 'eventId');
    app.get(url, { schema: { ...params, querystring: agendaQuerySchema } },
      scopeRoute((request, db, schoolId, classId) => {
        const period = agendaPeriod(request.query);
        if (!period) throw Object.assign(new Error('Période non valide.'), { statusCode: 400 });
        return listStaffEvents(db, schoolId, classId, period);
      }));

    app.post(url, { bodyLimit: 32 * 1024, schema: params },
      scopeRoute(async (request, db, schoolId, classId) => {
        const id = await createEvent(db, schoolId, classId, requireEvent(request.body));
        return id ? { id } : null;
      }, 201));

    app.put(url + '/:eventId', { bodyLimit: 32 * 1024, schema: { params: itemParams } },
      scopeRoute(async (request, db, schoolId, classId) => {
        const updated = await updateEvent(db, schoolId, classId, request.params.eventId, requireEvent(request.body));
        return updated ? undefined : null;
      }, 204));

    app.delete(url + '/:eventId', { schema: { params: itemParams } },
      scopeRoute(async (request, db, schoolId, classId) => {
        const removed = await deleteEvent(db, schoolId, classId, request.params.eventId);
        return removed ? undefined : null;
      }, 204));
  }

  register(prefix + '/classes/:classId/agenda', ['classId']);
  if (!canAccessClass) register(prefix + '/agenda', []);
}
