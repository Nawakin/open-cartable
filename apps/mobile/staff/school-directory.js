import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { layout, Select } from '../year-transition/ui';
import { downloadDocument } from '../files/documents';

const grades = ['TPS', 'PS', 'MS', 'GS', 'CP', 'CE1', 'CE2', 'CM1', 'CM2'];
const sections = { classes: 'Classes', students: 'Élèves', guardians: 'Tuteurs', invitations: 'Invitations' };
const empty = { displayName: '', levels: [], classId: '', grade: null, birthDate: null, departed: false, studentIds: [], active: true };
const path = '/directory';

function updateSet(values, id) {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

function guardianName(entry) {
  return entry.displayName || 'Tuteur ' + entry.id.slice(0, 8);
}

function csvFile(result) {
  function cell(input) {
    const checked = /^[=+\-@\t\r]/.test(input) ? "'" + input : input;
    return '"' + checked.replaceAll('"', '""') + '"';
  }
  const lines = [['École', 'Tuteur', 'Invitation', 'Expiration'], ...result.invitations.map(({ name, code, expiresAt }) =>
    [result.schoolCode, name, code, expiresAt])];
  const content = '\ufeff' + lines.map((line) => line.map(cell).join(';')).join('\r\n');
  const type = 'text/csv';
  const file = Platform.OS === 'web' ? new Blob([content], { type }) : { type, bytes: new TextEncoder().encode(content) };
  return downloadDocument(file, 'invitations-open-cartable', 'csv');
}

export function SchoolDirectory({ request, run, busy, onChanged }) {
  const [data, setData] = useState(null);
  const [section, setSection] = useState('classes');
  const [editor, setEditor] = useState(null);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState('');
  const [guardianIds, setGuardianIds] = useState([]);
  const [replaceSessions, setReplaceSessions] = useState(false);
  const [invitations, setInvitations] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const needle = filter.trim().toLocaleLowerCase('fr-FR');

  async function load() {
    setData(await request(path));
  }
  useEffect(() => { void run(load); }, []);

  function go(next) {
    setSection(next);
    setEditor(null);
    setFilter('');
    setInvitations(null);
    setMessage('');
    setConfirmed(false);
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
      setInvitations(await request(path + '/invitations', { method: 'POST', body: { guardianIds, replaceSessions } }));
      setGuardianIds([]);
      setReplaceSessions(false);
    });
  }

  const change = (patch) => { setConfirmed(false); setEditor((before) => ({ ...before, ...patch })); };
  const room = data?.classes.find(({ id }) => id === editor?.classId);
  const former = section === 'guardians' && editor?.id
    && data.guardians.find(({ id }) => id === editor.id)?.studentIds.some((id) => !editor.studentIds.includes(id));
  const valid = editor?.displayName.trim() && (section === 'classes' || (section === 'students'
    ? Boolean(room && (!editor.birthDate || /^\d{4}-\d{2}-\d{2}$/.test(editor.birthDate))) : editor.studentIds.length > 0));

  return <View style={layout.group}>
    <Text accessibilityRole="header" style={styles.title}>Classes et familles</Text>
    <View style={styles.actions}>
      {Object.entries(sections).map(([id, label]) => <Button key={id} label={label} selected={section === id}
        secondary={section !== id} busy={busy} onPress={() => go(id)} />)}
    </View>
    {!data && !busy && <Button label="Recharger l’annuaire" secondary onPress={() => void run(load)} />}
    {message && <Text accessibilityLiveRegion="polite" style={styles.label}>{message}</Text>}
    {data && section === 'invitations' && <>
      <Text style={styles.body}>Sélectionnez les tuteurs qui doivent recevoir une invitation.</Text>
      <Field label="Rechercher un tuteur" value={filter} onChangeText={setFilter} />
      <View style={styles.actions}>
        {data.guardians.filter((entry) => entry.active && entry.studentIds.length && guardianName(entry).toLocaleLowerCase('fr-FR').includes(needle))
          .map((entry) => <Button key={entry.id} label={guardianName(entry)} selected={guardianIds.includes(entry.id)}
            secondary={!guardianIds.includes(entry.id)} busy={busy} onPress={() => setGuardianIds(updateSet(guardianIds, entry.id))} />)}
      </View>
      <View style={styles.actions}>
        <Button label="Fermer aussi les anciennes sessions" selected={replaceSessions} secondary={!replaceSessions}
          busy={busy} onPress={() => setReplaceSessions(!replaceSessions)} />
        <Button label="Générer les invitations" busy={busy || !guardianIds.length} onPress={issue} />
      </View>
      {invitations && <View style={layout.card}>
        <Text style={styles.label}>Code école · {invitations.schoolCode}</Text>
        {invitations.invitations.map(({ id, name, code }) => <Text key={id} selectable style={styles.body}>{name || 'Tuteur'} · {code}</Text>)}
        <View style={styles.actions}>
          <Button label="Télécharger les codes en CSV" icon="download-outline" secondary busy={busy}
            onPress={() => void run(() => csvFile(invitations))} />
          <Button label="Masquer les codes" secondary onPress={() => setInvitations(null)} />
        </View>
      </View>}
    </>}
    {data && section !== 'invitations' && (editor ? <View style={layout.card}>
      <Text accessibilityRole="header" style={layout.heading}>{editor.id ? 'Modifier la fiche' : 'Ajouter une fiche'}</Text>
      <Field label={section === 'classes' ? 'Nom de la classe' : 'Nom d’affichage'} value={editor.displayName}
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
        <Text style={styles.label}>Élèves rattachés</Text>
        <View style={styles.actions}>{data.students.map(({ id, displayName }) =>
          <Button key={id} label={displayName} selected={editor.studentIds.includes(id)} secondary={!editor.studentIds.includes(id)}
            busy={busy} onPress={() => change({ studentIds: updateSet(editor.studentIds, id) })} />)}</View>
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
      <View style={styles.actions}><Button label="Ajouter" icon="add-outline" busy={busy}
        onPress={() => { setConfirmed(false); setEditor(empty); }} /></View>
      <Field label="Rechercher une fiche" value={filter} onChangeText={setFilter} />
      {data[section].filter((entry) => (entry.name ?? guardianName(entry)).toLocaleLowerCase('fr-FR').includes(needle)).map((entry) => (
        <View key={entry.id} style={[layout.card, layout.cardHeader]}>
          <View style={layout.details}>
            <Text style={styles.label}>{entry.name ?? guardianName(entry)}</Text>
            <Text style={layout.status}>{section === 'classes' ? entry.levels.join(' · ') : section === 'students'
              ? entry.className + (entry.departed ? ' · Parti' : '') : entry.studentIds.length + ' enfant(s)' + (entry.active ? '' : ' · Suspendu')}</Text>
          </View>
          <Button label="Modifier" accessibilityLabel={'Modifier ' + (entry.name ?? guardianName(entry))} secondary busy={busy}
            onPress={() => { setConfirmed(false); setEditor({ ...empty, ...entry, displayName: entry.name ?? entry.displayName }); }} />
        </View>
      ))}
    </>)}
  </View>;
}
