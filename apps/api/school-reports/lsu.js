const namespace = 'urn:fr:edu:scolarite:lsun:bilans:import';
const subjects = {
  french: 'FRA-RAC', math: 'MAT-RAC', languages: 'LV1-RAC',
  arts: 'ART-RAC', pe: 'EPS-RAC', citizenship: 'EMC-RAC',
};
const primaryLevels = Object.freeze(['CP', 'CE1', 'CE2', 'CM1', 'CM2']);
const cycleThree = new Set(['CM1', 'CM2']);
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const invalidXml = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
const escapes = /[&<>"']/g;
export const lsuVersions = ['10.0', '9.0'];
export const lsuLevels = primaryLevels;

export function validXmlText(value, max) {
  return Boolean(value.trim()) && [...value].length <= max && !invalidXml.test(value);
}

function xml(value) {
  return String(value).replace(escapes, (character) => entities[character]);
}

function attributes(values) {
  return Object.entries(values).map(([name, value]) => {
    const escaped = xml(value).replace(/[\t\n\r]/g, (character) => '&#' + character.charCodeAt(0) + ';');
    return ' ' + name + '="' + escaped + '"';
  }).join('');
}

function subjectCode(subject, grade) {
  if (subject === 'science') return cycleThree.has(grade) ? 'STC-RAC' : 'QLM-RAC';
  return subjects[subject];
}

export function lsuReportProblems({ assessments, appreciation, grade }) {
  const problems = [];
  if (grade && !lsuLevels.includes(grade)) problems.push('Le LSU périodique couvre les niveaux du CP au CM2.');
  if (!validXmlText(appreciation.trim(), 1500)) problems.push('Appréciation générale requise, 1 500 caractères maximum.');
  const assessed = assessments.filter(({ mark }) => mark !== 'NR');
  if (assessed.length < 3) problems.push('Trois domaines évalués au minimum.');
  if (assessed.some(({ programme }) => !programme?.length || programme.some((item) => !validXmlText(item.trim(), 300)))) {
    problems.push('Renseigner les éléments de programme pour chaque domaine évalué.');
  }
  if (assessments.some(({ subject, note }) => (subject !== 'science' && !Object.hasOwn(subjects, subject))
    || (note.trim() && !validXmlText(note.trim(), 600)))) problems.push('Vérifier les domaines et leurs appréciations.');
  return problems;
}

export function buildLsuXml({ version, uai, idBe, className, year, term, from, to, createdOn, director, teachers, positions, reports }) {
  const programme = new Map();
  for (const { assessments } of reports) {
    for (const { mark, programme: items = [] } of assessments) {
      if (mark === 'NR') continue;
      for (const item of items) if (!programme.has(item.trim())) programme.set(item.trim(), 'PR' + (programme.size + 1));
    }
  }
  const staffAttributes = ({ civility, name, givenName }, id) => attributes({ id, civilite: civility, nom: name, prenom: givenName });
  const teacherIds = teachers.map((_, index) => 'ENS' + (index + 1));
  const studentIds = reports.map((_, index) => 'EL' + (index + 1));
  const acquisitions = (report) => report.assessments.map(({ subject, mark, note, programme: items = [] }) => {
    const fields = { 'code-domaine': subjectCode(subject, report.grade) };
    if (mark === 'NR') fields['non-evalue'] = 'true';
    else {
      fields.positionnement = positions[mark];
      fields['element-programme-refs'] = Array.from(new Set(items.map((item) => programme.get(item.trim())))).join(' ');
    }
    const appreciation = note.trim() ? '<appreciation>' + xml(note.trim()) + '</appreciation>' : '';
    return '          <acquis' + attributes(fields) + '>' + appreciation + '</acquis>';
  });
  const classFields = { id: 'CL1', 'id-be': idBe, 'type-positionnement': 0 };
  if (validXmlText(className, 50)) classFields.libelle = className;
  return Buffer.from([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<lsun-bilans xmlns="' + namespace + '" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
      + attributes({ 'xsi:schemaLocation': namespace + ' import-bilan-1d.xsd', schemaVersion: version }) + '>',
    '  <entete>',
    '    <editeur>Open Cartable</editeur>',
    '    <application>Open Cartable</application>',
    '    <etablissement>' + xml(uai) + '</etablissement>',
    '  </entete>',
    '  <donnees>',
    '    <directeurs><directeur' + staffAttributes(director, 'DIR1') + '/></directeurs>',
    '    <classes><classe' + attributes(classFields) + '/></classes>',
    '    <eleves>',
    ...reports.map(({ ine }, index) => '      <eleve' + attributes({ id: studentIds[index], ine, 'classe-ref': 'CL1' }) + '/>'),
    '    </eleves>',
    '    <periodes><periode' + attributes({ id: 'PE1', millesime: year, indice: term, 'nb-periodes': 3,
      'date-debut': from, 'date-fin': to }) + '/></periodes>',
    '    <enseignants>',
    ...teachers.map((teacher, index) => '      <enseignant' + staffAttributes(teacher, teacherIds[index]) + '/>'),
    '    </enseignants>',
    '    <elements-programme>',
    ...Array.from(programme, ([label, id]) => '      <element-programme' + attributes({ id, libelle: label }) + '/>'),
    '    </elements-programme>',
    '    <bilans-periodiques>',
    ...reports.flatMap((report, index) => [
      '      <bilan-periodique' + attributes({ 'eleve-ref': studentIds[index], 'periode-ref': 'PE1',
        'enseignant-refs': teacherIds.join(' '), 'date-creation': createdOn, 'date-scolarite': report.schoolingDate || from,
        'directeur-ref': 'DIR1' }) + '>',
      '        <liste-acquis>', ...acquisitions(report), '        </liste-acquis>',
      '        <appreciation-generale>' + xml(report.appreciation.trim()) + '</appreciation-generale>',
      '      </bilan-periodique>',
    ]),
    '    </bilans-periodiques>',
    '  </donnees>',
    '</lsun-bilans>',
    '',
  ].join('\n'), 'utf8');
}
