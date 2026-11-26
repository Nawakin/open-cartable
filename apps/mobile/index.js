import { registerRootComponent } from 'expo';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { errorMessage, parseSchoolAddress } from './parent/http';
import { getTutorReference, listAgenda, listAgendaReminders, listChildren, listHomework, needsSchoolAddress, requestMessages, requestParent, signIn, signOut } from './parent/session';
import { Homework, dayInSchoolCalendar, periodRange } from './parent/homework';
import { Button, Field, styles } from './parent/ui';
import { consumeInstallationLink, FirstRun, needsInstallation } from './installation/first-run';
import { Staff } from './staff/staff';
import { AgendaReminders, ParentAgenda } from './agenda/agenda-view';
import { agendaRange } from './agenda/dates';
import { Messages } from './messaging/messages';
import { useUnreadMessages } from './messaging/unread';
import { AppFrame, SectionNav } from './navigation';
import { ParentLiaison } from './liaison/parent-liaison';
import { ParentBlog } from './blog/parent-blog';
import { FamilyPhotoAuthorizations } from './photo-authorizations/family';
import { useSchoolBanner } from './school-banner/session';
import { ParentAttendance } from './attendance/monthly';
import { AccountLink } from './account-link';
import { Illustration, IllustratedMenu } from './illustrations';
import { ParentReports } from './school-reports/reports';
import { ParentLibrary } from './files/library';
import { PushSettings } from './notifications/settings';

const emptyReminders = { reminders: [], nextCursor: null };
const parentSections = ['children', 'homework', 'agenda', 'liaison', 'blog', 'attendance', 'reports', 'library', 'messages', 'account'];
const welcomeImage = require('./assets/accueil.jpg');

function openTeacher() {
  window.location.assign('/?espace=enseignant');
}

function ParentApp() {
  const [phase, setPhase] = useState('loading');
  const [installationToken, setInstallationToken] = useState(consumeInstallationLink);
  const [children, setChildren] = useState([]);
  const [reminders, setReminders] = useState(emptyReminders);
  const [reminderError, setReminderError] = useState('');
  const [tutorReference, setTutorReference] = useState(null);
  const [schoolPanel, setSchoolPanel] = useState(null);
  const [classLifeChild, setClassLifeChild] = useState(null);
  const [address, setAddress] = useState('');
  const [school, setSchool] = useState('');
  const [invitation, setInvitation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inProgress = useRef(false);
  const signedIn = parentSections.includes(phase);
  const { banner } = useSchoolBanner(requestParent, signedIn);
  const unread = useUnreadMessages(requestMessages, signedIn);

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
    setClassLifeChild(null);
    setReminders(emptyReminders);
    setReminderError('');
    try {
      const roster = await listChildren();
      if (roster === null) {
        setPhase('login');
        if (requireSession) setError('La session n’a pas pu être ouverte. Contactez votre école pour obtenir un nouveau code.');
      } else {
        setChildren(roster);
        setPhase('children');
        if (roster.length) await loadReminders();
      }
    } catch (failure) {
      setPhase('unavailable');
      throw failure;
    }
  }

  async function loadReminders(cursor) {
    setReminderError('');
    try {
      const page = await listAgendaReminders(cursor);
      if (page === null) {
        setChildren([]);
        setTutorReference(null);
        setReminders(emptyReminders);
        setPhase('login');
        return;
      }
      setReminders((before) => cursor ? {
        reminders: Array.from(new Map([...before.reminders, ...page.reminders].map((item) => [item.id, item])).values()),
        nextCursor: page.nextCursor,
      } : page);
    } catch (failure) {
      if (failure.status === 404) return;
      setReminderError('Les rappels sont indisponibles. Utilisez « Actualiser » pour réessayer.');
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

  function openSchoolPanel(child, kind, anchor = dayInSchoolCalendar()) {
    setTutorReference(null);
    setReminders(emptyReminders);
    void run(() => loadSchoolPanel({ child, kind, anchor, view: 'week', domain: '' }));
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
      setReminders(emptyReminders);
      setReminderError('');
      setTutorReference(null);
      setSchoolPanel(null);
      setClassLifeChild(null);
      setInvitation('');
      setPhase('login');
    });
  }

  function showParentSection(section) {
    setTutorReference(null);
    setSchoolPanel(null);
    setError('');
    setPhase(section);
    if (section === 'children' && children.length) void run(() => loadReminders());
  }

  const menu = signedIn && <SectionNav label="Menu parent" busy={busy}
    active={signedIn && phase !== 'messages' && phase !== 'account' ? 'children' : phase}
    items={[
      { id: 'children', art: 'home', label: 'Accueil', onPress: () => showParentSection('children') },
      { id: 'messages', label: 'Messagerie', unreadCount: unread.count,
        onPress: () => showParentSection('messages') },
      { id: 'account', label: 'Compte', onPress: () => showParentSection('account') },
    ]} />;

  return (
    <AppFrame menu={menu} scrollKey={phase} banner={banner} roleLabel={signedIn ? 'Espace parent' : undefined}
      onLogout={signedIn && !['homework', 'agenda'].includes(phase) ? logout : undefined} busy={busy}>
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
          <Image source={welcomeImage} resizeMode="cover" accessible={false} aria-hidden style={shell.welcome} />
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
          <Button label={busy ? 'Connexion…' : 'Se connecter'} icon="log-in-outline" busy={busy} onPress={submit} />
        </View>
      )}

      {phase === 'children' && (
        <>
          <AgendaReminders page={reminders} busy={busy} error={reminderError}
            onOpen={(reminder) => openSchoolPanel(reminder.child, 'agenda', dayInSchoolCalendar(new Date(reminder.startsAt)))}
            onMore={() => void run(() => loadReminders(reminders.nextCursor))} />
          <View style={styles.panel}>
            <Text accessibilityRole="header" style={styles.title}>Vos enfants</Text>
            {children.length === 0 && <Text style={styles.body}>Aucun enfant n’est rattaché à votre compte. Contactez votre école.</Text>}
            {children.map((child) => (
              <View key={child.id} style={shell.child}>
                <View style={shell.childHeader}>
                  <View style={shell.childIcon}>
                    <Illustration name="school" size={38} />
                  </View>
                  <View style={shell.childDetails}>
                    <Text style={shell.childName}>{child.displayName}</Text>
                    <Text style={styles.body}>{child.className}</Text>
                  </View>
                </View>
                <IllustratedMenu compact busy={busy} items={[
                  { id: 'homework', label: 'Cahier de texte', accessibilityLabel: `Cahier de texte de ${child.displayName}`,
                    onPress: () => openSchoolPanel(child, 'homework') },
                  { id: 'agenda', label: 'Agenda', accessibilityLabel: `Agenda de ${child.displayName}`,
                    onPress: () => openSchoolPanel(child, 'agenda') },
                  { id: 'attendance', label: 'Absences', accessibilityLabel: `Absences de ${child.displayName}`,
                    onPress: () => { setSchoolPanel({ child }); setPhase('attendance'); } },
                  { id: 'class-life', label: 'Vie de classe', accessibilityLabel: `Vie de classe de ${child.displayName}`,
                    expanded: classLifeChild === child.id,
                    onPress: () => setClassLifeChild((current) => current === child.id ? null : child.id) },
                ]} />
                {classLifeChild === child.id && <View style={shell.childLinks}>
                  <IllustratedMenu compact busy={busy} items={[
                    { id: 'liaison', label: 'Cahier de liaison', accessibilityLabel: `Cahier de liaison de ${child.displayName}`,
                      onPress: () => { setSchoolPanel({ child }); setPhase('liaison'); } },
                    { id: 'blog', label: 'Blog de classe', accessibilityLabel: `Blog de classe de ${child.displayName}`,
                      onPress: () => { setSchoolPanel({ child }); setPhase('blog'); } },
                    { id: 'reports', art: 'homework', label: 'Livret scolaire', accessibilityLabel: `Livret scolaire de ${child.displayName}`,
                      onPress: () => { setSchoolPanel({ child }); setPhase('reports'); } },
                    { id: 'library', art: 'blog', label: 'Médiathèque', accessibilityLabel: `Médiathèque de ${child.displayName}`,
                      onPress: () => { setSchoolPanel({ child }); setPhase('library'); } },
                  ]} />
                </View>}
              </View>
            ))}
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <Button label="Actualiser" icon="refresh-outline" busy={busy} onPress={() => void run(load)} secondary />
            </View>
          </View>
        </>
      )}

      {phase === 'messages' && <View style={styles.panel}>
        <Messages children={children} request={requestMessages} refreshUnread={unread.refresh} onExpired={() => void run(load)} />
      </View>}

      {phase === 'account' && <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>Mon compte</Text>
        <FamilyPhotoAuthorizations request={requestParent} run={run} busy={busy} onExpired={load} />
        <Text style={styles.body}>Votre référence tuteur permet à l’école de vous écrire ou de vous proposer un rendez-vous individuel.</Text>
        {tutorReference && <Text accessibilityLabel="Référence tuteur" selectable style={styles.label}>{tutorReference}</Text>}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <Button label={tutorReference ? 'Masquer ma référence tuteur' : 'Afficher ma référence tuteur'}
            icon={tutorReference ? 'eye-off-outline' : 'eye-outline'} busy={busy} onPress={toggleTutorReference} secondary />
        </View>
        {Platform.OS === 'web' && <AccountLink role="parent" request={requestParent}
          onOpen={openTeacher} onExpired={() => void run(load)} />}
        {Platform.OS === 'web' && <PushSettings request={requestParent} onExpired={() => void run(load)} />}
      </View>}

      {phase === 'homework' && schoolPanel && (
        <Homework
          key={schoolPanel.child.id}
          notebook={schoolPanel}
          onChange={(selection) => void run(() => loadSchoolPanel(selection))}
          onMore={() => void run(() => loadSchoolPanel(schoolPanel, true))}
          onBack={() => void run(load)}
          onLogout={logout}
          onDocument={(id, download) => void run(async () => {
            const url = '/children/' + encodeURIComponent(schoolPanel.child.id) + '/homework/' + id + '/document';
            download(await requestParent(url, { responseType: 'attachment' }), 'cahier-de-texte');
          })}
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

      {phase === 'liaison' && schoolPanel && (
        <ParentLiaison key={schoolPanel.child.id} child={schoolPanel.child} request={requestParent}
          onBack={() => showParentSection('children')} onExpired={() => void run(load)} />
      )}

      {phase === 'blog' && schoolPanel && (
        <ParentBlog key={schoolPanel.child.id} child={schoolPanel.child} request={requestParent}
          onBack={() => showParentSection('children')} onExpired={() => void run(load)} />
      )}

      {phase === 'attendance' && schoolPanel && (
        <ParentAttendance key={schoolPanel.child.id} child={schoolPanel.child} request={requestParent}
          onBack={() => showParentSection('children')} onExpired={() => void run(load)} />
      )}

      {phase === 'reports' && schoolPanel && <ParentReports key={schoolPanel.child.id} child={schoolPanel.child}
        request={requestParent} onBack={() => showParentSection('children')} onExpired={() => void run(load)} />}
      {phase === 'library' && schoolPanel && <ParentLibrary key={schoolPanel.child.id} child={schoolPanel.child}
        request={requestParent} onBack={() => showParentSection('children')} onExpired={() => void run(load)} />}

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
      {role ? <Staff role={role} onParent={() => window.location.assign('/')} /> : <ParentApp />}
    </SafeAreaProvider>
  );
}

const shell = StyleSheet.create({
  welcome: { width: '100%', height: 132, borderRadius: 12, backgroundColor: '#e5e6d3' },
  child: { padding: 11, backgroundColor: '#f2ede1', borderRadius: 14, gap: 10 },
  childHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  childIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fffaf0', borderRadius: 12 },
  childDetails: { flex: 1, minWidth: 0 },
  childName: { color: '#132d25', fontSize: 18, fontWeight: '700' },
  childLinks: { paddingTop: 10, borderTopWidth: 1, borderTopColor: '#d5dfd1' },
});

registerRootComponent(App);
