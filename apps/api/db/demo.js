import { transaction } from './database.js';

export const demo = {
  school: { id: '10000000-0000-4000-8000-000000000001', code: 'ECOLE-DEMO' },
  classes: [
    { id: '20000000-0000-4000-8000-000000000001', name: 'Classe fictive A' },
    { id: '20000000-0000-4000-8000-000000000002', name: 'Classe fictive B' },
  ],
  students: [
    { id: '30000000-0000-4000-8000-000000000001', name: 'Élève fictif A', classIndex: 0, guardianIndex: 0 },
    { id: '30000000-0000-4000-8000-000000000002', name: 'Élève fictif B', classIndex: 1, guardianIndex: 0 },
    { id: '30000000-0000-4000-8000-000000000003', name: 'Élève fictif C', classIndex: 0, guardianIndex: 1 },
  ],
  guardians: ['40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002'],
};

export async function seedDemo(pool) {
  await transaction(pool, async (client) => {
    const { id: schoolId, code } = demo.school;
    await client.query('INSERT INTO schools (id, code) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [schoolId, code]);
    for (const { id, name } of demo.classes) {
      await client.query(
        'INSERT INTO classes (school_id, id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [schoolId, id, name],
      );
    }
    for (const id of demo.guardians) {
      await client.query('INSERT INTO guardians (school_id, id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [schoolId, id]);
    }
    for (const student of demo.students) {
      await client.query(
        'INSERT INTO students (school_id, id, class_id, display_name) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [schoolId, student.id, demo.classes[student.classIndex].id, student.name],
      );
      await client.query(
        'INSERT INTO guardian_students (school_id, guardian_id, student_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [schoolId, demo.guardians[student.guardianIndex], student.id],
      );
    }
  });
}
