import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useAttendanceTask } from '../attendance/ui';
import { downloadDocument } from '../files/documents';
import { Button, Field, styles } from '../parent/ui';
import { layout, Select } from '../year-transition/ui';

const labels = {
  french: 'Français', math: 'Mathématiques', languages: 'Langues vivantes', science: 'Sciences et technologie',
  arts: 'Enseignements artistiques', pe: 'Éducation physique et sportive', citizenship: 'Enseignement moral et civique',
};
const marks = { AC: 'Acquis', ENC: 'En cours d’acquisition', ENR: 'En réussite', NR: 'Non renseigné' };
const terms = ['1', '2', '3'].map((value) => ({ value, label: 'Trimestre ' + value }));
const option = (label) => ({ value: '', label });
const blank = (subject) => ({ subject, mark: 'NR', note: '' });

function ReportCard({ report, request, downloadPath, task }) {
  const [open, setOpen] = useState(false);
  return <View style={layout.card}>
    <Text style={styles.label}>{report.className} · {report.year}–{report.year + 1} · Trimestre {report.term}</Text>
    {!report.published && <Text style={styles.body}>Brouillon</Text>}
    <View style={styles.actions}>
      <Button label={open ? 'Masquer le bilan' : 'Voir le bilan'} secondary onPress={() => setOpen(!open)} />
      <Button label="Télécharger en PDF" icon="download-outline" busy={task.busy} secondary
        onPress={() => void task.run(async () => downloadDocument(await request(downloadPath, { responseType: 'pdf' }),
          'livret-' + report.year + '-t' + report.term))} />
    </View>
    {open && <>
      {report.assessments.map(({ subject, mark, note }) => <View key={subject} style={layout.details}>
        <Text style={styles.label}>{labels[subject]} · {marks[mark]}</Text>
        {note ? <Text style={styles.body}>{note}</Text> : null}
      </View>)}
      {report.appreciation ? <Text style={styles.body}>{report.appreciation}</Text> : null}
    </>}
  </View>;
}

export function ParentReports({ child, request, onBack, onExpired }) {
  const path = '/children/' + encodeURIComponent(child.id) + '/reports';
  const [data, setData] = useState(null);
  const task = useAttendanceTask(onExpired);
  const load = () => void task.run(async () => setData(await request(path)));
  useEffect(load, [path]);
  return <View style={styles.panel}>
    <View style={styles.actions}><Button label="Retour" icon="arrow-back-outline" secondary onPress={onBack} /></View>
    <Text accessibilityRole="header" style={styles.title}>Livret scolaire</Text>
    <Text style={styles.body}>{child.displayName}</Text>
    {task.error && <Text accessibilityRole="alert" style={styles.error}>{task.error}</Text>}
    {data && !data.reports.length && <Text style={styles.body}>Aucun bilan publié.</Text>}
    {data?.reports.map((report) => <ReportCard key={report.id} report={report} request={request} task={task}
      downloadPath={path + '/' + report.id + '/pdf'} />)}
    <View style={styles.actions}><Button label="Actualiser" secondary busy={task.busy} onPress={load} /></View>
  </View>;
}

export function StaffReports({ classes, request, onExpired, teacher }) {
  const [classId, setClassId] = useState(classes.length === 1 ? classes[0].id : '');
  const [studentId, setStudentId] = useState('');
  const [term, setTerm] = useState('1');
  const [data, setData] = useState(null);
  const [history, setHistory] = useState(null);
  const [report, setReport] = useState(undefined);
  const [subject, setSubject] = useState('french');
  const [marksBySubject, setMarks] = useState({});
  const [appreciation, setAppreciation] = useState('');
  const [notice, setNotice] = useState('');
  const task = useAttendanceTask(onExpired);
  const path = '/classes/' + encodeURIComponent(classId) + '/reports';
  const chosen = path + '/' + encodeURIComponent(studentId) + '?term=' + term;
  const assessment = marksBySubject[subject] ?? blank(subject);

  function loadRoster() {
    if (!classId) return;
    void task.run(async () => setData(await request(path)));
  }

  function useReport(value) {
    setReport(value);
    setMarks(Object.fromEntries((value?.assessments ?? []).map((assessment) => [assessment.subject, assessment])));
    setAppreciation(value?.appreciation ?? '');
  }

  function loadStudent() {
    if (!studentId) return;
    void task.run(async () => {
      if (teacher) useReport((await request(chosen)).report);
      else setHistory(await request('/students/' + encodeURIComponent(studentId) + '/reports'));
    });
  }

  useEffect(loadRoster, [classId]);
  useEffect(loadStudent, [studentId, term]);

  function save(published) {
    void task.run(async () => {
      const result = await request(chosen, { method: 'PUT', body: {
        revision: report?.revision ?? null, published, appreciation,
        assessments: Object.keys(labels).map((key) => marksBySubject[key] ?? blank(key)),
      } });
      useReport(result.report);
      setNotice(published ? 'Bilan publié.' : 'Brouillon enregistré.');
    });
  }

  return <View style={layout.group}>
    <Text accessibilityRole="header" style={styles.title}>Livret scolaire</Text>
    {!classes.length && <Text style={styles.body}>Aucune classe disponible.</Text>}
    {classes.length > 1 && <Select label="Classe" value={classId} disabled={task.busy}
      choices={[option('Choisir une classe'), ...classes.map(({ id, name }) => ({ value: id, label: name }))]}
      onChange={(id) => { setData(null); setClassId(id); setStudentId(''); setReport(undefined); setHistory(null); }} />}
    {data && <Select label="Élève" value={studentId} disabled={task.busy} choices={[option('Choisir un élève'),
      ...data.students.map(({ id, displayName }) => ({ value: id, label: displayName }))]}
      onChange={(id) => { setStudentId(id); setReport(undefined); setHistory(null); setNotice(''); }} />}
    {task.error && <Text accessibilityRole="alert" style={styles.error}>{task.error}</Text>}
    {task.error && <Button label="Actualiser" secondary busy={task.busy} onPress={studentId ? loadStudent : loadRoster} />}
    {notice && <Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text>}
    {studentId && teacher && <>
      <Select label="Période" value={term} choices={terms} disabled={task.busy}
        onChange={(value) => { setTerm(value); setReport(undefined); setNotice(''); }} />
      {report !== undefined && <>
        <Text style={styles.label}>Année {data.year}–{data.year + 1} · {report?.published ? 'Publié' : 'Brouillon'}</Text>
        <Select label="Domaine" value={subject} disabled={task.busy} onChange={setSubject}
          choices={Object.entries(labels).map(([value, label]) => ({ value, label }))} />
        <Select label="Niveau de maîtrise" value={assessment.mark} disabled={task.busy}
          choices={Object.entries(marks).map(([value, label]) => ({ value, label }))}
          onChange={(mark) => setMarks({ ...marksBySubject, [subject]: { ...assessment, mark } })} />
        <Field label="Appréciation du domaine" value={assessment.note} maxLength={600} multiline editable={!task.busy}
          onChangeText={(note) => setMarks({ ...marksBySubject, [subject]: { ...assessment, note } })} />
        <Field label="Appréciation générale" value={appreciation} maxLength={2000} multiline editable={!task.busy}
          onChangeText={setAppreciation} />
        <View style={styles.actions}>
          {!report?.published && <Button label="Enregistrer le brouillon" secondary busy={task.busy} onPress={() => save(false)} />}
          <Button label={report?.published ? 'Mettre à jour le bilan publié' : 'Publier le bilan'} busy={task.busy} onPress={() => save(true)} />
        </View>
      </>}
    </>}
    {history && !history.reports.length && <Text style={styles.body}>Aucun bilan enregistré.</Text>}
    {history?.reports.map((entry) => <ReportCard key={entry.id} report={entry} request={request} task={task}
      downloadPath={'/reports/' + entry.id + '/pdf'} />)}
  </View>;
}
