import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { migrate, openDatabase, transaction } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { setDirectionPassword } from '../direction/store.js';
import { buildLsuXml, lsuReportProblems } from './lsu.js';

const origin = 'https://ent.ecole.example';
const databaseUrl = process.env.TEST_DATABASE_URL;
const xsdDirectory = process.env.TEST_LSU_XSD_DIR;
const xsdHashes = {
  '9.0': '2e692ba9a412b724a59de3ca2aca0d907a503d083f38023f94dac69ed603a257',
  '10.0': 'd183a3709b1ac60bb5c8c513939b9c81bee3041c9770e38c0c63198f03082a1f',
};
const assessments = [
  { subject: 'french', mark: 'AC', note: 'Lecture à voix haute & compréhension.', programme: ['Lire un texte <simple>.'] },
  { subject: 'math', mark: 'ENC', note: '', programme: ['Comparer des nombres.'] },
  { subject: 'science', mark: 'ENR', note: 'Précis et autonome.', programme: ['Observer les changements d’état.'] },
  { subject: 'arts', mark: 'NR', note: '' },
];
const appreciation = 'Une progression régulière. Bravo !';
const details = {
  uai: '0000000A', idBe: '42', from: '2026-09-01', to: '2026-12-18', createdOn: '2026-12-19',
  director: { name: 'Directrice-Fictive', givenName: 'Camille', civility: 'MME' },
  teachers: [{ name: 'Enseignant-Fictif', givenName: 'Alex', civility: 'M' }],
  positions: { AC: 3, ENC: 2, ENR: 4 },
};

test('les deux variantes d’export valident les XSD premier degré vérifiés', { skip: !xsdDirectory }, async () => {
  for (const version of Object.keys(xsdHashes)) {
    const schema = join(xsdDirectory, 'livret-scolaire_1d_schema_' + version + '.xsd');
    const digest = createHash('sha256').update(await readFile(schema)).digest('hex');
    assert.equal(digest, xsdHashes[version]);
    const xml = buildLsuXml({ ...details, version, year: '2026', term: '1', className: 'CP–CM2 de démonstration',
      reports: [
        { assessments, appreciation, grade: 'CP', ine: '000000000AA' },
        { assessments, appreciation, grade: 'CM2', ine: '000000000AB', schoolingDate: '2026-10-05' },
      ],
    });
    const result = spawnSync('python3', ['-c', `
from lxml import etree
from sys import argv, stdin
parser = etree.XMLParser(no_network=True, resolve_entities=False)
schema = etree.XMLSchema(etree.parse(argv[1], parser))
schema.assertValid(etree.parse(stdin.buffer, parser))
`, schema], { input: xml, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(xml.toString(), /code-domaine="QLM-RAC"/);
    assert.match(xml.toString(), /code-domaine="STC-RAC"/);
    assert.match(xml.toString(), /Lire un texte &lt;simple&gt;\./);
  }
});

test('la direction exporte seulement les bilans publiés, complets et à jour de son école',
  { skip: !databaseUrl }, async (context) => {
    const name = 'lsu_test_' + randomUUID().replaceAll('-', '');
    const admin = openDatabase(databaseUrl);
    const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + name });
    const app = buildApp({ direction: { pool, webOrigin: origin } });
    context.after(async () => {
      await app.close();
      await pool.end();
      try { await admin.query('DROP SCHEMA IF EXISTS ' + name + ' CASCADE'); }
      finally { await admin.end(); }
    });
    await admin.query('CREATE SCHEMA ' + name);
    await migrate(pool);
    await seedDemo(pool);
    const foreignSchool = randomUUID();
    await pool.query("INSERT INTO schools (id, code) VALUES ($1, 'ECOLE-VOISINE')", [foreignSchool]);
    const password = randomBytes(24).toString('base64url');
    const hashed = await hashPassword(password);
    await transaction(pool, async (client) => {
      await setDirectionPassword(client, demo.school.id, hashed);
      await setDirectionPassword(client, foreignSchool, hashed);
    });

    function call(method, url, headers, payload) {
      return app.inject({ method, url: '/api/v1/direction/' + url, headers: { origin, ...headers }, payload });
    }
    async function login(schoolCode) {
      const response = await call('POST', 'auth/login', {}, { schoolCode, password });
      assert.equal(response.statusCode, 204);
      return { cookie: response.headers['set-cookie'].split(';')[0] };
    }
    const local = await login(demo.school.code);
    const foreign = await login('ECOLE-VOISINE');
    const [room] = demo.classes;
    const [child, , other] = demo.students;
    const revision = randomUUID();
    const report = randomUUID();
    const draft = randomUUID();
    await pool.query(`
      INSERT INTO school_reports (school_id,id,class_id,student_id,school_year,term,assessments,appreciation,published,revision)
      VALUES ($1,$2,$3,$4,2026,1,$5,$6,true,$7), ($1,$8,$3,$9,2026,1,$5,$6,false,$7)
    `, [demo.school.id, report, room.id, child.id, JSON.stringify(assessments), appreciation, revision, draft, other.id]);
    const path = 'reports/lsu/' + room.id + '?year=2026&term=1';
    const pupil = { id: report, grade: 'CP', ine: '000000000AA', revision };
    const input = { ...details, version: '10.0', reports: [pupil] };
    const preview = await call('GET', path, local);
    assert.equal(preview.statusCode, 200);
    assert.deepEqual(preview.json().reports.map(({ id, problems }) => ({ id, problems })), [{ id: report, problems: [] }]);
    assert.equal((await call('GET', 'reports/lsu', foreign)).json().periods.length, 0);
    assert.equal((await call('POST', path, {}, input)).statusCode, 401);
    assert.equal((await call('POST', path, foreign, input)).statusCode, 404);
    assert.equal((await call('POST', path, local, { ...input, reports: [{ ...pupil, id: draft }] })).statusCode, 404);
    assert.equal((await call('POST', path, local, { ...input, reports: [{ ...pupil, revision: randomUUID() }] })).statusCode, 409);
    assert.equal((await call('POST', path, local, { ...input, from: '2026-02-30' })).statusCode, 400);

    const download = await call('POST', path, local, input);
    assert.equal(download.statusCode, 200);
    assert.match(download.headers['content-type'], /^application\/xml/);
    assert.match(download.headers['content-disposition'], /import-lsun-\d+\.xml/);
    assert.equal(download.headers['cache-control'], 'no-store');
    assert.match(download.payload, /ine="000000000AA"/);
    assert.match(download.payload, /element-programme-refs="PR1"/);
    assert.equal(download.payload.includes(child.id), false);
    assert.equal(download.payload.includes(child.name), false);
    assert.equal(lsuReportProblems({ assessments, appreciation }).length, 0);
    assert.equal(lsuReportProblems({ assessments, appreciation: '' }).length, 1);
    await pool.query('UPDATE school_reports SET assessments = $2 WHERE id = $1',
      [report, JSON.stringify([{ subject: 'french', mark: 'AC', note: 'Texte sans programme' }])]);
    assert.equal((await call('POST', path, local, input)).statusCode, 422);
  });
