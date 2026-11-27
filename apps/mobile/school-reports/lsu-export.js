import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useAttendanceTask } from '../attendance/ui';
import { downloadDocument } from '../files/documents';
import { Button, Field, styles } from '../parent/ui';
import { layout, Select } from '../year-transition/ui';

const path = '/reports/lsu';
const blankIdentity = () => ({ civility: '', name: '', givenName: '' });
const blankDetails = () => ({ version: '10.0', uai: '', idBe: '', from: '', to: '', createdOn: '',
  director: blankIdentity(), teachers: [blankIdentity()], positions: { AC: 3, ENC: 2, ENR: 4 } });
const levels = ['CP', 'CE1', 'CE2', 'CM1', 'CM2'];
const datePattern = /^\d{4}-\d\d-\d\d$/;
const inePattern = /^\d{9}[A-Z0-9]{2}$/;
const key = ({ classId, year, term }) => [classId, year, term].join('/');
const positionChoices = ['Objectifs non atteints', 'Objectifs partiellement atteints', 'Objectifs atteints', 'Objectifs dépassés']
  .map((label, index) => ({ value: String(index + 1), label }));

function Identity({ label, value, onChange, busy }) {
  return <View style={layout.card}>
    <Text style={styles.label}>{label}</Text>
    <Select label={'Civilité · ' + label} value={value.civility} disabled={busy}
      choices={[{ value: '', label: 'Choisir' }, { value: 'M', label: 'Monsieur' }, { value: 'MME', label: 'Madame' }]}
      onChange={(civility) => onChange({ ...value, civility })} />
    <Field label={'Nom · ' + label} value={value.name} autoComplete="off" maxLength={100} editable={!busy}
      onChangeText={(name) => onChange({ ...value, name })} />
    <Field label={'Prénom · ' + label} value={value.givenName} autoComplete="off" maxLength={100} editable={!busy}
      onChangeText={(givenName) => onChange({ ...value, givenName })} />
  </View>;
}

function DateField({ label, value, onChangeText, busy }) {
  return <Field label={label} value={value} placeholder="AAAA-MM-JJ" autoComplete="off" maxLength={10}
    editable={!busy} onChangeText={onChangeText} />;
}

export function LsuExport({ request, onExpired, onBack }) {
  const [catalog, setCatalog] = useState(null);
  const [period, setPeriod] = useState('');
  const [reports, setReports] = useState(null);
  const [pupils, setPupils] = useState({});
  const [open, setOpen] = useState('');
  const [step, setStep] = useState('pupils');
  const [details, setDetails] = useState(blankDetails);
  const [done, setDone] = useState(false);
  const task = useAttendanceTask(onExpired);
  const chosen = catalog?.find((entry) => key(entry) === period);
  const endpoint = chosen ? path + '/' + chosen.classId + '?' + new URLSearchParams({ year: chosen.year, term: chosen.term }) : '';
  const selection = (reports ?? []).filter(({ id, problems }) => !problems.length && pupils[id]?.ine)
    .map(({ id, revision }) => {
      const { ine, grade, schoolingDate } = pupils[id];
      return { id, revision, ine, grade, ...(schoolingDate ? { schoolingDate } : {}) };
    });
  const goodPupilSelection = selection.length > 0 && selection.length <= 150 && selection.every(({ ine, grade, schoolingDate }) =>
    inePattern.test(ine) && levels.includes(grade) && (!schoolingDate || datePattern.test(schoolingDate)))
    && new Set(selection.map(({ ine }) => ine)).size === selection.length;

  function loadCatalog() {
    void task.run(async () => setCatalog((await request(path)).periods));
  }

  function loadReports() {
    if (!endpoint) return;
    void task.run(async () => setReports((await request(endpoint)).reports));
  }
  useEffect(loadCatalog, []);
  useEffect(loadReports, [endpoint]);

  function setPupil(report, changed) {
    setPupils((current) => ({ ...current,
      [report.id]: { ine: '', grade: report.grade ?? '', schoolingDate: '', ...current[report.id], ...changed },
    }));
  }

  function setField(name, value) {
    setDetails((current) => ({ ...current, [name]: value }));
  }

  function exportFile() {
    setDone(false);
    void task.run(async () => {
      const file = await request(endpoint, { method: 'POST', responseType: 'attachment',
        body: { ...details, reports: selection } });
      await downloadDocument(file, 'import-lsun-' + Date.now(), 'xml');
      setPupils({});
      setOpen('');
      setStep('pupils');
      setDone(true);
    });
  }

  const hasIdentities = [details.director, ...details.teachers].every(({ civility, name, givenName }) => civility && name.trim() && givenName.trim());
  const goodDetails = /^\d{7}[A-Z]$/.test(details.uai) && /^[1-9]\d{0,19}$/.test(details.idBe) && hasIdentities
    && [details.from, details.to, details.createdOn].every((date) => datePattern.test(date)) && details.from <= details.to
    && selection.every(({ schoolingDate }) => !schoolingDate || (schoolingDate >= details.from && schoolingDate <= details.to));

  return <View style={layout.group}>
    <View style={styles.actions}><Button label="Retour aux livrets" icon="arrow-back-outline" secondary onPress={onBack} /></View>
    <Text accessibilityRole="header" style={styles.title}>Export LSU XML</Text>
    {task.error && <Text accessibilityRole="alert" style={styles.error}>{task.error}</Text>}
    {done && <Text accessibilityLiveRegion="polite" style={styles.label}>Fichier XML téléchargé. Les INE saisis ont été effacés de ce formulaire.</Text>}
    {catalog?.length === 0 && <Text style={styles.body}>Publiez d’abord des bilans pour préparer un export.</Text>}
    {!catalog && task.error && <Button label="Actualiser" secondary busy={task.busy} onPress={loadCatalog} />}
    {step === 'pupils' && Boolean(catalog?.length) && <>
      <Select label="Classe et trimestre" value={period} disabled={task.busy}
        onChange={(value) => { setPeriod(value); setReports(null); setPupils({}); setOpen(''); setDone(false); setDetails(blankDetails()); }}
        choices={[{ value: '', label: 'Choisir' }, ...catalog.map((entry) => ({
          value: key(entry), label: entry.className + ' · ' + entry.year + '–' + (entry.year + 1) + ' · Trimestre ' + entry.term,
        }))]} />
      {chosen && <Text style={styles.body}>Renseignez les INE des élèves à inclure. Le fichier peut regrouper la classe pour ce trimestre.</Text>}
      {chosen && task.error && <Button label="Actualiser les bilans" secondary busy={task.busy} onPress={loadReports} />}
      {reports?.length === 0 && <Text style={styles.body}>Aucun bilan publié pour cette sélection.</Text>}
      {reports?.map((report) => <View key={report.id} style={layout.card}>
        <Text style={styles.label}>{report.studentName}</Text>
        {report.problems.length > 0 ? report.problems.map((problem) => <Text key={problem} style={layout.status}>{problem}</Text>) : <>
          <Button label={open === report.id ? 'Masquer les champs' : pupils[report.id]?.ine ? 'Modifier la sélection' : 'Inclure dans l’export'}
            accessibilityLabel={'Export LSU · ' + report.studentName} secondary onPress={() => setOpen(open === report.id ? '' : report.id)} />
          {open === report.id && <>
            <Field label="INE de l’élève" value={pupils[report.id]?.ine ?? ''} onChangeText={(value) => setPupil(report, { ine: value.toUpperCase() })}
              autoCapitalize="characters" autoComplete="off" maxLength={11} editable={!task.busy} />
            <Select label="Niveau dans cette classe" value={pupils[report.id]?.grade ?? report.grade ?? ''} disabled={task.busy}
              onChange={(grade) => setPupil(report, { grade })} choices={[{ value: '', label: 'Choisir' },
                ...levels.map((value) => ({ value, label: value }))]} />
            <DateField label="Date de scolarité dans la période (facultatif)" value={pupils[report.id]?.schoolingDate ?? ''}
              busy={task.busy} onChangeText={(schoolingDate) => setPupil(report, { schoolingDate })} />
          </>}
        </>}
      </View>)}
      {chosen && <View style={styles.actions}>
        <Button label="Période et identifiants de l’école" icon="arrow-forward-outline" busy={task.busy || !goodPupilSelection}
          onPress={() => { setStep('details'); setDone(false); }} />
      </View>}
    </>}
    {step === 'details' && <>
      <View style={styles.actions}><Button label="Revenir aux élèves" secondary busy={task.busy} onPress={() => setStep('pupils')} /></View>
      <Text style={styles.label}>{selection.length} bilan(s) · {chosen?.className} · Trimestre {chosen?.term}</Text>
      <View style={layout.card}>
        <Field label="UAI de l’école" value={details.uai} autoCapitalize="characters" autoComplete="off" maxLength={8}
          editable={!task.busy} onChangeText={(value) => setField('uai', value.toUpperCase())} />
        <Field label="Identifiant de la classe dans ONDE" value={details.idBe} keyboardType="number-pad" maxLength={20}
          editable={!task.busy} onChangeText={(value) => setField('idBe', value)} />
        <DateField label="Début du trimestre dans LSU" value={details.from} busy={task.busy} onChangeText={(value) => setField('from', value)} />
        <DateField label="Fin du trimestre dans LSU" value={details.to} busy={task.busy} onChangeText={(value) => setField('to', value)} />
        <DateField label="Date de création des bilans" value={details.createdOn} busy={task.busy} onChangeText={(value) => setField('createdOn', value)} />
      </View>
      <Identity label="Direction" value={details.director} busy={task.busy} onChange={(value) => setField('director', value)} />
      {details.teachers.map((teacher, index) => <View key={index} style={layout.group}>
        <Identity label={'Enseignant ' + (index + 1)} value={teacher} busy={task.busy}
          onChange={(value) => setField('teachers', details.teachers.map((current, i) => i === index ? value : current))} />
        {details.teachers.length > 1 && <View style={styles.actions}><Button label={'Retirer l’enseignant ' + (index + 1)}
          busy={task.busy} secondary onPress={() => setField('teachers', details.teachers.filter((_, i) => i !== index))} /></View>}
      </View>)}
      <View style={styles.actions}><Button label="Ajouter un enseignant" icon="add-outline" secondary
        busy={task.busy || details.teachers.length >= 30} onPress={() => setField('teachers', [...details.teachers, blankIdentity()])} /></View>
      <View style={layout.card}>
        <Text style={styles.label}>Correspondance des positionnements</Text>
        {Object.entries({ AC: 'Acquis', ENC: 'En cours d’acquisition', ENR: 'En réussite' }).map(([mark, label]) =>
          <Select key={mark} label={label} value={String(details.positions[mark])} choices={positionChoices} disabled={task.busy}
            onChange={(value) => setField('positions', { ...details.positions, [mark]: Number(value) })} />)}
        <Select label="Version du schéma LSU" value={details.version} disabled={task.busy}
          choices={[{ value: '10.0', label: '10.0' }, { value: '9.0', label: '9.0 (compatibilité)' }]}
          onChange={(value) => setField('version', value)} />
      </View>
      <View style={styles.actions}>
        <Button label="Télécharger le XML LSU" icon="download-outline" busy={task.busy || !goodDetails} onPress={exportFile} />
      </View>
    </>}
  </View>;
}
