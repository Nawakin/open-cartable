import { registerRootComponent } from 'expo';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage, parseSchoolAddress } from './parent/http';
import { getTutorReference, listAgenda, listChildren, listHomework, needsSchoolAddress, signIn, signOut } from './parent/session';
import { Homework, dayInSchoolCalendar, periodRange } from './parent/homework';
import { Button, Field, styles } from './parent/ui';
import { consumeInstallationLink, FirstRun, needsInstallation } from './installation/first-run';
import { Staff } from './staff/staff';
import { ParentAgenda } from './agenda/agenda-view';
import { agendaRange } from './agenda/dates';

function openDirection() {
  window.location.assign('/?espace=direction');
}

function openTeacher() {
  window.location.assign('/?espace=enseignant');
}

function AppFrame({ children }) {
  return (
    <SafeAreaView style={shell.safeArea}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={shell.scroll}>
        <View style={shell.content}>
          <View style={shell.header}>
            <Text style={shell.brand}>Open Cartable</Text>
          </View>
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ParentApp() {
  const [phase, setPhase] = useState('loading');
  const [installationToken, setInstallationToken] = useState(consumeInstallationLink);
  const [children, setChildren] = useState([]);
  const [tutorReference, setTutorReference] = useState(null);
  const [schoolPanel, setSchoolPanel] = useState(null);
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
    setTutorReference(null);
    setSchoolPanel(null);
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

  async function loadSchoolPanel(selection, append = false) {
    const showsAgenda = selection.kind === 'agenda';
    const key = showsAgenda ? 'events' : 'entries';
    const list = showsAgenda ? listAgenda : listHomework;
    const period = showsAgenda ? agendaRange(selection.anchor, selection.view) : {
      ...periodRange(selection.anchor, selection.view), domain: selection.domain,
    };
    if (!append) {
      setSchoolPanel({ ...selection, [key]: [], nextCursor: null });
      setPhase(selection.kind);
    }
    try {
      const page = await list(selection.child.id, {
        ...period,
        cursor: append ? selection.nextCursor : undefined,
      });
      if (page === null) {
        setChildren([]);
        setSchoolPanel(null);
        setPhase('login');
        return;
      }
      if (append && selection.child.classId !== page.child.classId) {
        await loadSchoolPanel({ ...selection, child: page.child });
        return;
      }
      const items = append ? [...selection[key], ...page[key]] : page[key];
      const unique = Array.from(new Map(items.map((item) => [item.id, item])).values());
      setSchoolPanel({ ...selection, child: page.child, [key]: unique, nextCursor: page.nextCursor });
    } catch (failure) {
      if (failure.status !== 404) throw failure;
      await load();
      setError('Cet espace n’est plus accessible pour votre compte.');
    }
  }

  function openSchoolPanel(child, kind) {
    setTutorReference(null);
    void run(() => loadSchoolPanel({ child, kind, anchor: dayInSchoolCalendar(), view: 'week', domain: '' }));
  }

  function toggleTutorReference() {
    if (tutorReference) {
      setTutorReference(null);
      return;
    }
    void run(async () => {
      const reference = await getTutorReference();
      if (reference) setTutorReference(reference);
      else await load();
    });
  }

  useEffect(() => {
    void run(initialize);
  }, []);

  useEffect(() => {
    if (phase !== 'children' && phase !== 'homework' && phase !== 'agenda') return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run(schoolPanel ? () => loadSchoolPanel(schoolPanel) : load);
    });
    return () => subscription.remove();
  }, [phase, schoolPanel]);

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
      setTutorReference(null);
      setSchoolPanel(null);
      setInvitation('');
      setPhase('login');
    });
  }

  return (
    <AppFrame>
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
          {Platform.OS === 'web' && <Button label="Espace direction" busy={busy} onPress={openDirection} secondary />}
          {Platform.OS === 'web' && <Button label="Espace enseignant" busy={busy} onPress={openTeacher} secondary />}
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
                onPress={() => openSchoolPanel(child, 'homework')}
                secondary
              />
              <Button label="Consulter l’agenda" accessibilityLabel={`Agenda de ${child.displayName}`} busy={busy}
                onPress={() => openSchoolPanel(child, 'agenda')} secondary />
            </View>
          ))}
          {tutorReference && (
            <View style={shell.child}>
              <Text style={styles.body}>Transmettez cette référence à l’école pour fixer un rendez-vous individuel.</Text>
              <Text accessibilityLabel="Référence tuteur" selectable style={styles.label}>{tutorReference}</Text>
            </View>
          )}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Button label={tutorReference ? 'Masquer ma référence tuteur' : 'Afficher ma référence tuteur'}
              busy={busy} onPress={toggleTutorReference} secondary />
            <Button label="Actualiser" busy={busy} onPress={() => void run(load)} secondary />
            <Button label={busy ? 'Déconnexion…' : 'Se déconnecter'} busy={busy} onPress={logout} secondary />
            {Platform.OS === 'web' && <Button label="Espace direction" busy={busy} onPress={openDirection} secondary />}
            {Platform.OS === 'web' && <Button label="Espace enseignant" busy={busy} onPress={openTeacher} secondary />}
          </View>
        </View>
      )}

      {phase === 'homework' && schoolPanel && (
        <Homework
          key={schoolPanel.child.id}
          notebook={schoolPanel}
          onChange={(selection) => void run(() => loadSchoolPanel(selection))}
          onMore={() => void run(() => loadSchoolPanel(schoolPanel, true))}
          onBack={() => void run(load)}
          onLogout={logout}
          busy={busy}
          error={error}
        />
      )}

      {phase === 'agenda' && schoolPanel && (
        <ParentAgenda calendar={schoolPanel} busy={busy} error={error} onLogout={logout}
          onChange={(selection) => void run(() => loadSchoolPanel(selection))}
          onMore={() => void run(() => loadSchoolPanel(schoolPanel, true))}
          onBack={() => void run(load)} />
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
    </AppFrame>
  );
}

function App() {
  const section = Platform.OS === 'web' ? new URLSearchParams(window.location.search).get('espace') : null;
  const role = section === 'direction' ? 'direction' : (section === 'enseignant' ? 'teacher' : null);
  return (
    <SafeAreaProvider>
      {role ? <AppFrame><Staff role={role} onParent={() => window.location.assign('/')}
        onOtherStaff={role === 'teacher' ? openDirection : openTeacher} /></AppFrame> : <ParentApp />}
    </SafeAreaProvider>
  );
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
