import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { layout, Select } from '../year-transition/ui';
import { downloadDocument } from '../files/documents';
import { DirectoryImport, DirectoryTracking } from '../school-life/directory-tools';

const grades = ['TPS', 'PS', 'MS', 'GS', 'CP', 'CE1', 'CE2', 'CM1', 'CM2'];
const sections = { classes: 'Classes', students: 'Élèves', guardians: 'Accès parents', invitations: 'Invitations', tools: 'Rentrée et suivi' };
const empty = { displayName: '', levels: [], classId: '', grade: null, birthDate: null, departed: false, studentIds: [], active: true };
const visibleStudents = 12;
const path = '/directory';

function updateSet(values, id) {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

function guardianName(entry) {
  return entry.displayName || 'Responsable ' + entry.id.slice(0, 8);
}

function studentLabel(student) {
  return student.displayName + ' · ' + student.className + (student.departed ? ' · Parti' : '');
}

function searchText(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-FR').trim();
}

function csvFile(result) {
  function cell(input) {
    const checked = /^[=+\-@\t\r]/.test(input) ? "'" + input : input;
    return '"' + checked.replaceAll('"', '""') + '"';
  }
  const lines = [['École', 'Responsable', 'Invitation', 'Expiration'], ...result.invitations.map(({ name, code, expiresAt }) =>
    [result.schoolCode, name, code, expiresAt])];
  const content = '\ufeff' + lines.map((line) => line.map(cell).join(';')).join('\r\n');
  const type = 'text/csv';
  const file = Platform.OS === 'web' ? new Blob([content], { type }) : { type, bytes: new TextEncoder().encode(content) };
  return downloadDocument(file, 'invitations-open-cartable', 'csv');
}

export function SchoolDirectory({ request, run, busy, onChanged, onExpired }) {
  const [data, setData] = useState(null);
  const [section, setSection] = useState('classes');
  const [editor, setEditor] = useState(null);
  const [filter, setFilter] = useState('');
  const [studentFilter, setStudentFilter] = useState('');
  const [studentLimit, setStudentLimit] = useState(visibleStudents);
  const [message, setMessage] = useState('');
  const [guardianIds, setGuardianIds] = useState([]);
  const [replaceSessions, setReplaceSessions] = useState(false);
  const [invitations, setInvitations] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [tool, setTool] = useState('import');
  const needle = searchText(filter);
  const studentNeedle = searchText(studentFilter);
  const activeClasses = new Set(data?.classes.map(({ id }) => id));
  const studentsById = new Map(data?.students.map((student) => [student.id, student]));
  const inSchool = (student) => !student.departed && activeClasses.has(student.classId);
  const guardians = (data?.guardians ?? []).map((entry) => {
    const children = entry.studentIds.map((id) => studentsById.get(id)).filter(Boolean);
    const eligible = entry.active && children.some(inSchool);
    const match = searchText(guardianName(entry)).includes(needle)
      || children.some(({ displayName }) => searchText(displayName).includes(needle));
    return { ...entry, children, eligible, match };
  });
  const selectedStudents = (editor?.studentIds ?? []).map((id) => studentsById.get(id)).filter(Boolean);
  const studentChoices = (data?.students ?? []).filter((student) => inSchool(student)
    && !editor?.studentIds.includes(student.id)
    && searchText(student.displayName + ' ' + student.className).includes(studentNeedle));

  async function load() {
    setData(await request(path));
  }
  useEffect(() => { void run(load); }, []);

  function go(next) {
    setSection(next);
    setEditor(null);
    setFilter('');
    setStudentFilter('');
    setGuardianIds([]);
    setReplaceSessions(false);
    setInvitations(null);
    setMessage('');
    setConfirmed(false);
  }

  function editEntry(entry = empty) {
    setEditor({ ...empty, ...entry, displayName: entry.name ?? entry.displayName ?? '' });
    setStudentFilter('');
    setStudentLimit(visibleStudents);
    setMessage('');
    setConfirmed(false);
  }

  function inviteGuardian(id) {
    go('invitations');
    setGuardianIds([id]);
  }

  function save() {
    void run(async () => {
      const { id, displayName, levels, classId, grade, birthDate, departed, studentIds, active } = editor;
      const body = section === 'classes' ? { displayName, levels } : section === 'students'
        ? { displayName, classId, grade, birthDate, departed } : { displayName, studentIds, active };
      await request(path + '/' + section + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PUT' : 'POST', body });
      setEditor(null);
      setConfirmed(false);
      setMessage('Fiche enregistrée.');
      await load();
      if (section === 'classes') await onChanged();
    });
  }

  function issue() {
    void run(async () => {
      setInvitations(await request(path + '/invitations', {
        method: 'POST', body: { guardianIds: selectedGuardians.map(({ id }) => id), replaceSessions },
      }));
      setGuardianIds([]);
      setReplaceSessions(false);
    });
  }

  const change = (patch) => { setConfirmed(false); setEditor((before) => ({ ...before, ...patch })); };
  const room = data?.classes.find(({ id }) => id === editor?.classId);
  const former = section === 'guardians' && editor?.id
    && guardians.find(({ id }) => id === editor.id)?.studentIds.some((id) => !editor.studentIds.includes(id));
  const valid = editor?.displayName.trim() && (section === 'classes' || (section === 'students'
    ? Boolean(room && (!editor.birthDate || /^\d{4}-\d{2}-\d{2}$/.test(editor.birthDate))) : editor.studentIds.length > 0));
  const selectedGuardians = guardians.filter(({ eligible, id }) => eligible && guardianIds.includes(id));
  const directoryEntries = section === 'guardians' ? guardians.filter(({ match }) => match)
    : (data?.[section] ?? []).filter((entry) => searchText(entry.name ?? entry.displayName).includes(needle));

  return <View style={layout.group}>
    <Text accessibilityRole="header" style={styles.title}>Classes et familles</Text>
    <View style={styles.actions}>
      {Object.entries(sections).map(([id, label]) => <Button key={id} label={label} selected={section === id}
        secondary={section !== id} busy={busy} onPress={() => go(id)} />)}
    </View>
    {!data && !busy && <Button label="Recharger l’annuaire" secondary onPress={() => void run(load)} />}
    {message && <Text accessibilityLiveRegion="polite" style={styles.label}>{message}</Text>}
    {data && section === 'invitations' && <>
      <Text style={styles.body}>Chaque responsable reçoit un code personnel qui ouvre l’accès à tous ses enfants rattachés.</Text>
      <Field label="Rechercher un responsable ou un enfant" value={filter} onChangeText={setFilter} />
      {guardians.filter(({ eligible, match, id }) => eligible && (match || guardianIds.includes(id))).map((entry) => (
        <View key={entry.id} style={[layout.card, layout.cardHeader]}>
          <View style={layout.details}>
            <Text style={styles.label}>{guardianName(entry)}</Text>
            <Text style={layout.status}>{entry.children.filter(inSchool).map(({ displayName }) => displayName).join(' · ')}</Text>
          </View>
          <Button label={guardianIds.includes(entry.id) ? 'Sélectionné' : 'Sélectionner'}
            accessibilityLabel={(guardianIds.includes(entry.id) ? 'Retirer l’invitation pour ' : 'Sélectionner l’invitation pour ') + guardianName(entry)}
            selected={guardianIds.includes(entry.id)}
            secondary={!guardianIds.includes(entry.id)} busy={busy} onPress={() => setGuardianIds(updateSet(guardianIds, entry.id))} />
        </View>
      ))}
      <View style={styles.actions}>
        <Button label="Fermer aussi les anciennes sessions" selected={replaceSessions} secondary={!replaceSessions}
          busy={busy} onPress={() => setReplaceSessions(!replaceSessions)} />
        <Button label={selectedGuardians.length === 1 ? 'Générer le code' : 'Générer les invitations'}
          busy={busy || !selectedGuardians.length} onPress={issue} />
      </View>
      {invitations && <View style={layout.card}>
        <Text style={styles.label}>Code école · {invitations.schoolCode}</Text>
        {invitations.invitations.map(({ id, name, code }) =>
          <Text key={id} selectable style={styles.body}>{name || guardianName({ id })} · {code}</Text>)}
        <View style={styles.actions}>
          <Button label="Télécharger les codes en CSV" icon="download-outline" secondary busy={busy}
            onPress={() => void run(() => csvFile(invitations))} />
          <Button label="Masquer les codes" secondary onPress={() => setInvitations(null)} />
        </View>
      </View>}
    </>}
    {data && section === 'tools' && <>
      <View style={styles.actions}>{[['import', 'Importer'], ['invitations', 'Suivi des invitations'], ['audit', 'Journal des accès']]
        .map(([id, label]) => <Button key={id} label={label} selected={tool === id} secondary={tool !== id} onPress={() => setTool(id)} />)}</View>
      {tool === 'import' ? <DirectoryImport request={request} onExpired={onExpired} onImported={async () => {
        await load();
        await onChanged();
      }} /> : <DirectoryTracking key={tool} request={request} section={tool} onExpired={onExpired} />}
    </>}
    {data && !['invitations', 'tools'].includes(section) && (editor ? <View style={layout.card}>
      <Text accessibilityRole="header" style={layout.heading}>{section === 'guardians'
        ? (editor.id ? 'Modifier l’accès parent' : 'Nouvel accès parent') : (editor.id ? 'Modifier la fiche' : 'Ajouter une fiche')}</Text>
      <Field label={section === 'classes' ? 'Nom de la classe' : section === 'guardians' ? 'Nom du responsable' : 'Nom d’affichage'} value={editor.displayName}
        maxLength={100} editable={!busy} onChangeText={(displayName) => change({ displayName })} />
      {section === 'classes' && <View style={styles.actions}>{grades.map((grade) =>
        <Button key={grade} label={grade} selected={editor.levels.includes(grade)} secondary={!editor.levels.includes(grade)}
          busy={busy} onPress={() => change({ levels: updateSet(editor.levels, grade) })} />)}</View>}
      {section === 'students' && <>
        <Select label="Classe" value={room?.id ?? ''} disabled={busy} choices={[
          { value: '', label: 'Choisir une classe active' }, ...data.classes.map(({ id, name }) => ({ value: id, label: name })),
        ]} onChange={(classId) => change({ classId, grade: null })} />
        <Select label="Niveau" value={editor.grade ?? ''} disabled={busy} choices={[
          { value: '', label: 'À préciser' }, ...(room?.levels.length ? room.levels : grades).map((grade) => ({ value: grade, label: grade })),
        ]} onChange={(grade) => change({ grade: grade || null })} />
        <Field label="Date de naissance facultative" value={editor.birthDate ?? ''} placeholder="AAAA-MM-JJ"
          maxLength={10} editable={!busy} onChangeText={(birthDate) => change({ birthDate: birthDate || null })} />
        {editor.id && <Button label={editor.departed ? 'Départ enregistré' : 'Marquer comme parti'}
          selected={editor.departed} secondary={!editor.departed} busy={busy} onPress={() => change({ departed: !editor.departed })} />}
      </>}
      {section === 'guardians' && <>
        <Text style={styles.label}>Enfants rattachés</Text>
        {selectedStudents.map((student) => <View key={student.id} style={layout.cardHeader}>
          <Text style={[styles.body, layout.details]}>{studentLabel(student)}</Text>
          <Button label="Retirer" accessibilityLabel={'Retirer ' + studentLabel(student)} secondary busy={busy}
            onPress={() => change({ studentIds: editor.studentIds.filter((id) => id !== student.id) })} />
        </View>)}
        {!selectedStudents.length && <Text style={styles.body}>Ajoutez les enfants auxquels ce responsable doit avoir accès.</Text>}
        <Field label="Rechercher un élève à rattacher" placeholder="Nom ou classe" value={studentFilter}
          editable={!busy} onChangeText={(value) => {
            setStudentFilter(value);
            setStudentLimit(visibleStudents);
          }} />
        {studentChoices.slice(0, studentLimit).map((student) => <View key={student.id} style={layout.cardHeader}>
          <Text style={[styles.body, layout.details]}>{studentLabel(student)}</Text>
          <Button label="Ajouter" accessibilityLabel={'Ajouter ' + studentLabel(student)} secondary busy={busy}
            onPress={() => change({ studentIds: [...editor.studentIds, student.id] })} />
        </View>)}
        {studentChoices.length > studentLimit && <Button label="Afficher plus d’élèves" secondary busy={busy}
          onPress={() => setStudentLimit((limit) => limit + visibleStudents)} />}
        {studentNeedle && !studentChoices.length && <Text style={layout.status}>Aucun autre élève ne correspond.</Text>}
        {editor.id && <Button label={editor.active ? 'Suspendre l’accès du tuteur' : 'Réactiver l’accès du tuteur'}
          secondary busy={busy} onPress={() => change({ active: !editor.active })} />}
        {!editor.active && <Text style={styles.body}>L’accès et les invitations seront révoqués à l’enregistrement.</Text>}
        {former && <Text style={styles.body}>La dissociation retire l’accès de ce tuteur à l’élève ainsi que les échanges liés à cette tutelle.</Text>}
      </>}
      <View style={styles.actions}>
        <Button label={confirmed ? 'Confirmer l’enregistrement' : 'Enregistrer'} busy={busy || !valid}
          onPress={() => { if (former && !confirmed) setConfirmed(true); else save(); }} />
        <Button label="Annuler" secondary busy={busy} onPress={() => { setEditor(null); setConfirmed(false); }} />
      </View>
    </View> : <>
      <View style={styles.actions}><Button label={section === 'guardians' ? 'Ajouter un responsable' : 'Ajouter'}
        icon="add-outline" busy={busy} onPress={() => editEntry()} /></View>
      <Field label={section === 'guardians' ? 'Rechercher un responsable ou un enfant' : 'Rechercher une fiche'}
        value={filter} onChangeText={setFilter} />
      {directoryEntries.map((entry) => (
        <View key={entry.id} style={[layout.card, layout.cardHeader]}>
          <View style={layout.details}>
            <Text style={styles.label}>{entry.name ?? guardianName(entry)}</Text>
            <Text style={layout.status}>{section === 'classes' ? entry.levels.join(' · ') : section === 'students'
              ? entry.className + (entry.departed ? ' · Parti' : '') : entry.children.map(studentLabel).join(' / ')}</Text>
            {section === 'guardians' && !entry.active && <Text style={layout.status}>Accès suspendu</Text>}
          </View>
          <View style={styles.actions}>
            <Button label="Modifier" accessibilityLabel={'Modifier ' + (entry.name ?? guardianName(entry))} secondary busy={busy}
              onPress={() => editEntry(entry)} />
            {section === 'guardians' && entry.eligible && <Button label="Inviter"
              accessibilityLabel={'Inviter ' + guardianName(entry)} secondary busy={busy} onPress={() => inviteGuardian(entry.id)} />}
          </View>
        </View>
      ))}
    </>)}
  </View>;
}
