import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Field, styles } from './parent/ui';
import { validPassword } from './direction-security/fields';

export function AccountLink({ role, request, onOpen, onExpired }) {
  const teacher = role === 'teacher';
  const path = teacher ? '/parent-link' : '/web/teacher-link';
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);

  async function run(operation, quiet = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (failure) {
      if (failure.status === 401) onExpired();
      else if (!quiet) {
        setError(failure.status === 422 ? 'Le mot de passe enseignant est incorrect.'
          : failure.status === 409 ? 'Cette association est indisponible. Vérifiez les deux comptes connectés et actualisez.'
            : 'Les accès n’ont pas pu être actualisés. Réessayez dans un instant.');
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function load(quiet = false) {
    void run(async () => {
      setStatus(await request(path));
      setPassword('');
      setEditing(false);
    }, quiet);
  }
  useEffect(() => { load(!teacher); }, []);

  function open() {
    void run(async () => {
      try {
        await request(path + '/open', { method: 'POST' });
      } catch (failure) {
        if (failure.status === 404) setStatus(await request(path));
        throw failure;
      }
      onOpen();
    });
  }

  function remove() {
    void run(async () => {
      await request(path, { method: 'DELETE' });
      setStatus(await request(path));
      setEditing(false);
    });
  }

  function associate() {
    void run(async () => {
      setStatus(await request(path, { method: 'PUT', body: { parentId: status.candidate.id, password } }));
      setPassword('');
    });
  }

  if (!teacher && !status?.linked && !error) return null;

  return <View style={appearance.card}>
    <Text accessibilityRole="header" style={styles.label}>{teacher ? 'Mes accès' : 'Compte enseignant associé'}</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {status?.linked ? <View style={styles.actions}>
      {editing ? <>
        <Button label="Confirmer la dissociation" busy={busy} onPress={remove} />
        <Button label="Annuler" secondary busy={busy} onPress={() => setEditing(false)} />
      </> : <>
        <Button label={teacher ? 'Espace parent' : 'Espace enseignant'} icon="swap-horizontal-outline" busy={busy} onPress={open} />
        <Button label="Dissocier les comptes" secondary busy={busy} onPress={() => setEditing(true)} />
      </>}
    </View> : teacher && <>
      {status?.candidate ? <>
        <Text style={styles.body}>Compte parent connecté pour {status.candidate.children.join(', ')}.</Text>
        <Field label="Mot de passe enseignant" value={password} onChangeText={setPassword}
          secureTextEntry autoComplete="current-password" editable={!busy} maxLength={256} />
        <View style={styles.actions}>
          <Button label="Associer les comptes" icon="link-outline" busy={busy || !validPassword(password)} onPress={associate} />
          <Button label="Actualiser" secondary busy={busy} onPress={() => load()} />
        </View>
      </> : <>
        {status && <>
          <Text style={styles.body}>Connectez votre compte parent de cette école avec le code reçu pour vos enfants.</Text>
          <Button label="Ouvrir la connexion parent dans un autre onglet" secondary busy={busy}
            onPress={() => window.open('/?espace=parent', '_blank', 'noopener,noreferrer')} />
        </>}
        {!status && busy && <Text style={styles.body}>Vérification des accès…</Text>}
        <Button label="Vérifier le compte parent" secondary busy={busy} onPress={() => load()} />
      </>}
    </>}
  </View>;
}

const appearance = StyleSheet.create({
  card: { borderRadius: 14, backgroundColor: '#f3f4eb', borderWidth: 1, borderColor: '#e3e5d7', padding: 14, gap: 10 },
});
