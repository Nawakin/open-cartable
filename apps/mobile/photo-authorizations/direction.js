import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { AuthorizationStatus, authorizationOptions } from './ui';

const updated = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

function authorizationPath(classId) {
  return '/classes/' + encodeURIComponent(classId) + '/photo-authorizations';
}

export function DirectionPhotoAuthorizations({ classes, request, run, busy }) {
  const [classId, setClassId] = useState(null);
  const [students, setStudents] = useState(null);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const needle = search.trim().toLocaleLowerCase('fr-FR');
  const visible = students?.filter(({ displayName }) => displayName.toLocaleLowerCase('fr-FR').includes(needle));
  const student = students?.find(({ id }) => id === editing?.id);

  async function load(id) {
    setClassId(id);
    setStudents(null);
    setEditing(null);
    const result = await request(authorizationPath(id));
    setStudents(result.students);
  }

  function choose(id) {
    void run(async () => {
      setNotice('');
      setSearch('');
      await load(id);
    });
  }

  useEffect(() => {
    if (classes.length === 1) choose(classes[0].id);
  }, []);

  function save() {
    void run(async () => {
      try {
        const record = await request(authorizationPath(classId) + '/' + encodeURIComponent(student.id), {
          method: 'PUT', body: { status: editing.status, revision: student.revision },
        });
        setStudents((previous) => previous.map((entry) => entry.id === record.id ? record : entry));
        setEditing(null);
        setNotice('Autorisation photo enregistrée.');
      } catch (error) {
        if (error.status !== 409) throw error;
        await load(classId);
        setNotice('Cette autorisation a changé. Le registre a été actualisé.');
      }
    });
  }

  return <View style={ui.group}>
    <Text accessibilityRole="header" style={styles.title}>Autorisations photo</Text>
    {classes.length === 0 && <Text style={styles.body}>Aucune classe n’est configurée.</Text>}
    {classes.length === 1 && <Text style={styles.body}>{classes[0].name}</Text>}
    {classes.length > 1 && <View style={styles.actions}>
      {classes.map(({ id, name }) => <Button key={id} label={name} icon="school-outline"
        selected={classId === id} secondary={classId !== id} onPress={() => choose(id)} busy={busy} />)}
    </View>}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text> : null}
    {classId && <View style={styles.actions}>
      <Button label="Actualiser" accessibilityLabel="Actualiser le registre" icon="refresh-outline"
        onPress={() => choose(classId)} busy={busy} secondary />
    </View>}
    {students?.length > 5 && <Field label="Rechercher un élève" value={search} onChangeText={setSearch} maxLength={100} />}
    {students?.length === 0 && <Text style={styles.body}>Aucun élève dans cette classe.</Text>}
    {needle && visible?.length === 0 && <Text style={styles.body}>Aucun élève ne correspond à cette recherche.</Text>}
    {visible?.map((entry) => <View key={entry.id} style={ui.card}>
      <View style={ui.header}>
        <Text accessibilityRole="header" style={styles.label}>{entry.displayName}</Text>
        <AuthorizationStatus status={entry.status} />
      </View>
      {entry.updatedAt && <Text style={styles.body}>Mise à jour le {updated.format(new Date(entry.updatedAt))}</Text>}
      {editing?.id === entry.id ? <>
        <View style={styles.actions}>
          {authorizationOptions.map(({ id, label }) => <Button key={id} label={label}
            selected={editing.status === id} secondary={editing.status !== id} busy={busy}
            onPress={() => setEditing({ id: entry.id, status: id })} />)}
        </View>
        {entry.status === 'allowed' && editing.status !== 'allowed' && (
          <Text style={styles.body}>Les photos associées seront masquées dans le fil des familles.</Text>
        )}
        <View style={styles.actions}>
          <Button label="Enregistrer l’autorisation" icon="checkmark-outline" onPress={save}
            busy={busy || entry.status === editing.status} />
          <Button label="Annuler" secondary busy={busy} onPress={() => setEditing(null)} />
        </View>
      </> : <View style={styles.actions}>
        <Button label="Modifier" accessibilityLabel={'Modifier l’autorisation de ' + entry.displayName}
          icon="create-outline" onPress={() => { setNotice(''); setEditing({ id: entry.id, status: entry.status }); }}
          busy={busy} secondary />
      </View>}
    </View>)}
  </View>;
}

const ui = StyleSheet.create({
  group: { gap: 14 },
  card: { borderRadius: 13, backgroundColor: '#f0f4eb', padding: 14, gap: 10 },
  header: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, alignItems: 'center', justifyContent: 'space-between' },
});
