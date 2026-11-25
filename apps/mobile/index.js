import { registerRootComponent } from 'expo';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage, parseSchoolAddress } from './parent/http';
import { listChildren, listHomework, needsSchoolAddress, signIn, signOut } from './parent/session';
import { Homework, dayInSchoolCalendar, periodRange } from './parent/homework';
import { Button, Field, styles } from './parent/ui';
import { consumeInstallationLink, FirstRun, needsInstallation } from './installation/first-run';

function ParentApp() {
  const [phase, setPhase] = useState('loading');
  const [installationToken, setInstallationToken] = useState(consumeInstallationLink);
  const [children, setChildren] = useState([]);
  const [notebook, setNotebook] = useState(null);
  const [address, setAddress] = useState('');
  const [school, setSchool] = useState('');
  const [invitation, setInvitation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inProgress = useRef(false);

  async function run(operation) {
    if (inProgress.current) return;
    inProgress.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      inProgress.current = false;
      setBusy(false);
    }
  }

  async function load(requireSession = false) {
    setPhase('loading');
    setChildren([]);
    setNotebook(null);
    try {
      const roster = await listChildren();
      if (roster === null) {
        setPhase('login');
        if (requireSession) setError('La session n’a pas pu être ouverte. Contactez votre école pour obtenir un nouveau code.');
      } else {
        setChildren(roster);
        setPhase('children');
      }
    } catch (failure) {
      setPhase('unavailable');
      throw failure;
    }
  }

  async function initialize() {
    setPhase('loading');
    try {
      if (await needsInstallation()) {
        setPhase('setup');
        return;
      }
    } catch (failure) {
      setPhase('unavailable');
      throw failure;
    }
    setInstallationToken('');
    await load();
  }

  async function loadNotebook(selection, append = false) {
    if (!append) {
      setNotebook({ ...selection, entries: [], nextCursor: null });
      setPhase('homework');
    }
    try {
      const page = await listHomework(selection.child.id, {
        ...periodRange(selection.anchor, selection.view),
        domain: selection.domain,
        cursor: append ? selection.nextCursor : undefined,
      });
      if (page === null) {
        setChildren([]);
        setNotebook(null);
        setPhase('login');
        return;
      }
      if (append && selection.child.classId !== page.child.classId) {
        await loadNotebook({ ...selection, child: page.child });
        return;
      }
      const entries = append ? [...selection.entries, ...page.entries] : page.entries;
      // Une entrée modifiée peut réapparaître sur une page suivante.
      const uniqueEntries = Array.from(new Map(entries.map((entry) => [entry.id, entry])).values());
      setNotebook({ ...selection, child: page.child, entries: uniqueEntries, nextCursor: page.nextCursor });
    } catch (failure) {
      if (failure.status !== 404) throw failure;
      await load();
      setError('Ce cahier n’est plus accessible pour votre compte.');
    }
  }

  function openNotebook(child) {
    void run(() => loadNotebook({ child, anchor: dayInSchoolCalendar(), view: 'week', domain: '' }));
  }

  useEffect(() => {
    void run(initialize);
  }, []);

  useEffect(() => {
    if (phase !== 'children' && phase !== 'homework') return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run(phase === 'homework' ? () => loadNotebook(notebook) : load);
    });
    return () => subscription.remove();
  }, [phase, notebook]);

  function submit() {
    void run(async () => {
      const origin = needsSchoolAddress ? parseSchoolAddress(address) : undefined;
      if (needsSchoolAddress && !origin) {
        setError('Saisissez l’adresse HTTPS de votre école, sans chemin.');
        return;
      }
      const schoolCode = school.trim().toUpperCase();
      const letters = invitation.toUpperCase().replaceAll(/[\s-]/g, '');
      if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(schoolCode) || !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(letters)) {
        setError('Vérifiez le code de l’école et le code d’invitation à 12 caractères.');
        return;
      }
      const code = letters.match(/.{4}/g).join('-');
      await signIn({ origin, schoolCode, code });
      setInvitation('');
      await load(true);
    });
  }

  function logout() {
    void run(async () => {
      await signOut();
      setChildren([]);
      setNotebook(null);
      setInvitation('');
      setPhase('login');
    });
  }

  return (
    <SafeAreaView style={shell.safeArea}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={shell.scroll}>
        <View style={shell.content}>
          <View style={shell.header}>
            <Text style={shell.brand}>Open Cartable</Text>
          </View>

          {phase === 'loading' && (
            <View style={styles.panel}>
              <ActivityIndicator accessibilityLabel="Chargement" color="#225344" />
              <Text style={styles.body}>Chargement de votre espace…</Text>
            </View>
          )}

          {phase === 'setup' && (
            <FirstRun token={installationToken} onComplete={(result) => {
              setInstallationToken('');
              setSchool(result?.schoolCode ?? '');
              setInvitation(result?.code ?? '');
              setPhase('login');
            }} />
          )}

          {phase === 'login' && (
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.title}>Connexion parent</Text>
              <Text style={styles.body}>Saisissez les codes remis par votre école.</Text>
              {needsSchoolAddress && (
                <Field
                  label="Adresse de l’école"
                  value={address}
                  onChangeText={setAddress}
                  autoCapitalize="none"
                  keyboardType="url"
                  placeholder="https://ent.ecole.example"
                  maxLength={512}
                  editable={!busy}
                />
              )}
              <Field label="Code de l’école" value={school} onChangeText={setSchool} autoCapitalize="characters" maxLength={32} editable={!busy} />
              <Field
                label="Code d’invitation"
                value={invitation}
                onChangeText={setInvitation}
                autoCapitalize="characters"
                secureTextEntry
                maxLength={24}
                onSubmitEditing={submit}
                returnKeyType="go"
                editable={!busy}
              />
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <Button label={busy ? 'Connexion…' : 'Se connecter'} busy={busy} onPress={submit} />
            </View>
          )}

          {phase === 'children' && (
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.title}>Vos enfants</Text>
              {children.length === 0 && <Text style={styles.body}>Aucun enfant n’est rattaché à votre compte. Contactez votre école.</Text>}
              {children.map((child) => (
                <View key={child.id} style={shell.child}>
                  <Text style={shell.childName}>{child.displayName}</Text>
                  <Text style={styles.body}>{child.className}</Text>
                  <Button
                    label="Consulter le cahier"
                    accessibilityLabel={`Cahier de texte de ${child.displayName}`}
                    busy={busy}
                    onPress={() => openNotebook(child)}
                    secondary
                  />
                </View>
              ))}
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Button label="Actualiser" busy={busy} onPress={() => void run(load)} secondary />
                <Button label={busy ? 'Déconnexion…' : 'Se déconnecter'} busy={busy} onPress={logout} secondary />
              </View>
            </View>
          )}

          {phase === 'homework' && notebook && (
            <Homework
              key={notebook.child.id}
              notebook={notebook}
              onChange={(selection) => void run(() => loadNotebook(selection))}
              onMore={() => void run(() => loadNotebook(notebook, true))}
              onBack={() => void run(load)}
              onLogout={logout}
              busy={busy}
              error={error}
            />
          )}

          {phase === 'unavailable' && (
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.title}>Votre espace est indisponible</Text>
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Button label="Réessayer" busy={busy} onPress={() => void run(initialize)} />
                <Button label="Se déconnecter" busy={busy} onPress={logout} secondary />
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function App() {
  return <SafeAreaProvider><ParentApp /></SafeAreaProvider>;
}

const shell = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f3f0e5' },
  scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 20, paddingVertical: 36 },
  content: { width: '100%', maxWidth: 560, gap: 18 },
  header: { backgroundColor: '#17372d', paddingHorizontal: 24, paddingVertical: 18, borderRadius: 18 },
  brand: { color: '#fff7df', fontSize: 23, fontWeight: '800', letterSpacing: -0.5 },
  child: { paddingVertical: 13, paddingHorizontal: 16, backgroundColor: '#eef1e9', borderRadius: 12, gap: 4 },
  childName: { color: '#132d25', fontSize: 18, fontWeight: '700' },
});

registerRootComponent(App);
