import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';

const statusLabels = {
  active: 'Activé',
  pending: 'En attente d’activation',
  expired: 'Code expiré',
};

export function TeacherDirectory({ classes, request, run, busy, schoolAddress }) {
  const origin = Platform.OS === 'web' ? window.location.origin : schoolAddress;
  const [teachers, setTeachers] = useState(null);
  const [login, setLogin] = useState('');
  const [classIds, setClassIds] = useState([]);
  const [editing, setEditing] = useState(null);
  const [issued, setIssued] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [message, setMessage] = useState('');
  const [validation, setValidation] = useState('');

  async function reload() {
    const result = await request('/teachers');
    setTeachers(result.teachers);
  }

  useEffect(() => {
    void run(reload);
  }, []);

  function resetForm() {
    setEditing(null);
    setLogin('');
    setClassIds([]);
    setValidation('');
  }

  function edit(teacher) {
    setEditing(teacher.id);
    setLogin(teacher.login);
    setClassIds(teacher.classIds);
    setConfirmation(null);
    setIssued(null);
    setValidation('');
    setMessage('');
  }

  function save() {
    void run(async () => {
      setIssued(null);
      setConfirmation(null);
      setValidation('');
      setMessage('');
      if (!editing && (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(login.trim().toLowerCase()) || classIds.length === 0)) {
        setValidation('Choisissez un identifiant de 3 à 32 caractères et au moins une classe.');
        return;
      }
      if (editing) {
        await request(`/teachers/${editing}/classes`, { method: 'PUT', body: { classIds } });
        setMessage('Affectations enregistrées.');
      } else {
        setIssued(await request('/teachers', { method: 'POST', body: { login: login.trim().toLowerCase(), classIds } }));
      }
      resetForm();
      await reload();
    });
  }

  function confirm() {
    void run(async () => {
      const { id, operation } = confirmation;
      setIssued(null);
      setValidation('');
      setMessage('');
      if (operation === 'reset') {
        setIssued(await request(`/teachers/${id}/activation`, { method: 'POST' }));
      } else {
        await request(`/teachers/${id}`, { method: 'DELETE' });
        if (editing === id) resetForm();
        setMessage('Compte retiré.');
      }
      setConfirmation(null);
      await reload();
    });
  }

  return (
    <View style={directoryStyles.group}>
      <Text accessibilityRole="header" style={directoryStyles.heading}>Comptes enseignants</Text>
      {issued && (
        <View style={directoryStyles.card}>
          <Text style={styles.label}>Code d’activation de {issued.login}</Text>
          <Text selectable style={directoryStyles.code}>{issued.code}</Text>
          <Text style={styles.body}>Transmettez ce code en privé avec le code de l’école. Il expire dans sept jours.</Text>
          {origin && <Text selectable style={styles.label}>{origin}</Text>}
          <Button label="Masquer le code" onPress={() => setIssued(null)} busy={busy} secondary />
        </View>
      )}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.body}>{message}</Text> : null}
      <Text accessibilityRole="header" style={directoryStyles.heading}>{editing ? 'Modifier les affectations' : 'Créer un compte enseignant'}</Text>
      <Field label="Identifiant enseignant" value={login} onChangeText={setLogin} editable={!busy && !editing}
        autoCapitalize="none" maxLength={32} placeholder="ex. enseignant-a" />
      <Text style={styles.label}>Classes affectées</Text>
      {classes.length === 0 && <Text style={styles.body}>Aucune classe n’est configurée.</Text>}
      <View style={styles.actions}>
        {classes.map(({ id, name }) => {
          const selected = classIds.includes(id);
          return (
            <Button key={id} label={name} accessibilityLabel={`${selected ? 'Désaffecter' : 'Affecter'} ${name}`}
              busy={busy} secondary={!selected}
              onPress={() => setClassIds((before) => selected ? before.filter((value) => value !== id) : [...before, id])} />
          );
        })}
      </View>
      {validation ? <Text accessibilityRole="alert" style={styles.error}>{validation}</Text> : null}
      <View style={styles.actions}>
        <Button label={editing ? 'Enregistrer les affectations' : 'Créer le compte enseignant'} onPress={save} busy={busy} />
        {editing && <Button label="Annuler" onPress={resetForm} busy={busy} secondary />}
      </View>

      <View style={styles.actions}>
        <Button label="Actualiser les comptes" onPress={() => void run(reload)} busy={busy} secondary />
      </View>
      {teachers?.length === 0 && <Text style={styles.body}>Aucun compte enseignant.</Text>}
      {teachers?.map((teacher) => (
        <View key={teacher.id} style={directoryStyles.card}>
          <Text accessibilityRole="header" style={directoryStyles.heading}>{teacher.login}</Text>
          <Text style={styles.body}>{statusLabels[teacher.status]}</Text>
          <Text style={styles.body}>{classes.filter(({ id }) => teacher.classIds.includes(id)).map(({ name }) => name).join(', ') || 'Aucune classe affectée'}</Text>
          {confirmation?.id === teacher.id ? (
            <>
              <Text style={styles.body}>{confirmation.operation === 'reset'
                ? 'La réinitialisation ferme les sessions de cet enseignant et lui demande une nouvelle activation.'
                : 'Le retrait ferme les sessions de cet enseignant. Ses publications restent dans le cahier.'}</Text>
              <View style={styles.actions}>
                <Button label={confirmation.operation === 'reset' ? 'Confirmer la réinitialisation' : 'Confirmer le retrait du compte'}
                  onPress={confirm} busy={busy} />
                <Button label="Annuler" onPress={() => setConfirmation(null)} busy={busy} secondary />
              </View>
            </>
          ) : (
            <View style={styles.actions}>
              <Button label="Affectations" accessibilityLabel={`Affectations de ${teacher.login}`} onPress={() => edit(teacher)} busy={busy} secondary />
              <Button label="Réinitialiser" accessibilityLabel={`Réinitialiser ${teacher.login}`}
                onPress={() => { setIssued(null); setConfirmation({ id: teacher.id, operation: 'reset' }); }} busy={busy} secondary />
              <Button label="Retirer" accessibilityLabel={`Retirer ${teacher.login}`}
                onPress={() => { setIssued(null); setConfirmation({ id: teacher.id, operation: 'delete' }); }} busy={busy} secondary />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const directoryStyles = StyleSheet.create({
  card: { padding: 16, borderRadius: 12, backgroundColor: '#eef1e9', gap: 8 },
  code: { color: '#132d25', fontSize: 19, fontWeight: '700' },
  group: { gap: 16 },
  heading: { color: '#132d25', fontSize: 19, fontWeight: '700' },
});
