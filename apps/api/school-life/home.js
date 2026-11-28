import { unreadParentThreads } from '../messaging/store.js';
import { activeChildren, parentActivities } from './activities.js';
import { schoolDaySql, shape, uuid } from './validation.js';

const childFields = `json_build_object('id',s.id,'displayName',s.display_name,'className',s.class_name) AS child`;

export async function nextAssignments(db, actor, childId = null) {
  const { rows } = await db.query(`
    WITH permitted AS (${activeChildren}), calendar AS (SELECT ${schoolDaySql} AS today)
    SELECT h.id,h.title,h.domain,h.entry_date::text AS date,${childFields}
    FROM permitted s JOIN homework_entries h ON h.school_id=$1 AND h.class_id=s.class_id CROSS JOIN calendar
    WHERE ($3::uuid IS NULL OR s.id=$3) AND h.publish_at<=statement_timestamp()
      AND h.kind='assignment' AND h.entry_date BETWEEN today AND today+13
    ORDER BY h.entry_date,s.display_name,h.id,s.id LIMIT 12
  `, [actor.school_id, actor.guardian_id, childId]);
  return rows;
}

async function upcomingEvents(db, actor, childId) {
  const { rows } = await db.query(`
    WITH permitted AS (${activeChildren})
    SELECT * FROM (
      SELECT DISTINCT ON (e.id) e.id,e.title,e.starts_at AS "startsAt",${childFields}
      FROM permitted s JOIN agenda_events e ON e.school_id=$1 AND (e.class_id IS NULL OR e.class_id=s.class_id)
      WHERE ($3::uuid IS NULL OR s.id=$3) AND e.starts_at>=statement_timestamp()
        AND e.starts_at<statement_timestamp()+interval '14 days'
        AND (e.appointment_student_id IS NULL OR (e.appointment_student_id,e.appointment_guardian_id)=(s.id,$2))
      ORDER BY e.id,s.display_name,s.id
    ) events ORDER BY "startsAt",id LIMIT 12
  `, [actor.school_id, actor.guardian_id, childId]);
  return rows;
}

export function registerParentHome(app, authenticated) {
  app.get('/parent/home', { schema: { querystring: shape({ childId: uuid }, []) } },
    authenticated(async ({ query }, db, actor) => {
      const childId = query.childId ?? null;
      if (childId) {
        const { rows } = await db.query(activeChildren, [actor.school_id, actor.guardian_id]);
        if (!rows.some(({ id }) => id === childId)) return null;
      }
      const assignments = await nextAssignments(db, actor, childId);
      const events = await upcomingEvents(db, actor, childId);
      const messages = await unreadParentThreads(db, actor, childId);
      const actions = await parentActivities(db, actor, childId, true);
      return { assignments, events, messages, actions };
    }));
}
