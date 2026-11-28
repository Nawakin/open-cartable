import { registerRootComponent } from 'expo';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { errorMessage, parseSchoolAddress } from './parent/http';
import { getTutorReference, listAgenda, listChildren, listHomework, needsSchoolAddress, requestMessages, requestParent, signIn, signOut } from './parent/session';
import { Homework, dayInSchoolCalendar, periodRange } from './parent/homework';
import { Button, Field, styles } from './parent/ui';
import { consumeInstallationLink, FirstRun, needsInstallation } from './installation/first-run';
import { Staff } from './staff/staff';
import { ParentAgenda } from './agenda/agenda-view';
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
import { cleanupTemporaryDocuments, downloadDocument } from './files/documents';
import { PushSettings } from './notifications/settings';
import { useNativeNotificationDestination, useNativeNotifications } from './notifications/listen';
import { lastAccessRole, lastSchoolAddress, rememberAccessRole } from './access/remember';
import { DeviceSettings } from './devices/settings';
import { FamilyHome } from './school-life/home';
import { FamilyActivities } from './school-life/activities';
import { FamilyPlannedAbsences } from './school-life/absences';

const parentSections = ['children', 'homework', 'agenda', 'liaison', 'blog', 'attendance', 'reports', 'library', 'messages', 'account', 'notifications', 'activities', 'devices'];
const notificationLabels = {
  homework: 'Cahier de texte', assignments: 'Devoirs', reports: 'Livret scolaire', library: 'Médiathèque',
  agenda: 'Agenda', 'agenda-reminder': 'Rappel de l’agenda',
  liaison: 'Cahier de liaison', blog: 'Blog de classe', attendance: 'Absences', messages: 'Messagerie',
};
const welcomeImage = require('./assets/accueil.jpg');

function consumeNotification() {
  if (Platform.OS !== 'web') return null;
  const url = new URL(window.location.href);
  const kind = url.searchParams.get('notification');
  if (!kind) return null;
  url.searchParams.delete('notification');
  window.history.replaceState(window.history.state, '', url);
  return Object.hasOwn(notificationLabels, kind) ? kind : null;
}

function ParentApp({ onStaff, requestedNotification }) {
  const [phase, setPhase] = useState('loading');
  const [installationToken, setInstallationToken] = useState(consumeInstallationLink);
  const [notification, setNotification] = useState(consumeNotification);
  const [children, setChildren] = useState([]);
  const [home, setHome] = useState(null);
  const [homeError, setHomeError] = useState('');
  const [selectedChild, setSelectedChild] = useState('');
  const [activityId, setActivityId] = useState(null);
  const [threadId, setThreadId] = useState(null);
  const [tutorReference, setTutorReference] = useState(null);
  const [schoolPanel, setSchoolPanel] = useState(null);
  const [classLifeChild, setClassLifeChild] = useState(null);
  const [address, setAddress] = useState('');
  const [school, setSchool] = useState('');
  const [invitation, setInvitation] = useState('');
  const [staffOptions, setStaffOptions] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inProgress = useRef(false);
  const signedIn = parentSections.includes(phase);
  const { banner } = useSchoolBanner(requestParent, signedIn);
  const unread = useUnreadMessages(requestMessages, signedIn);
  useNativeNotifications(signedIn, requestParent);
  useEffect(() => {
    if (!requestedNotification) return;
    const { kind } = requestedNotification;
    setNotification(Object.hasOwn(notificationLabels, kind) ? kind : null);
    if (signedIn) showParentSection('children');
  }, [requestedNotification]);

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
    setHome(null);
    setHomeError('');
    try {
      const roster = await listChildren();
      if (roster === null) {
        setPhase('login');
        if (requireSession) setError('La session n’a pas pu être ouverte. Contactez votre école pour obtenir un nouveau code.');
      } else {
        setChildren(roster);
        setPhase('children');
        const selected = roster.some(({ id }) => id === selectedChild) ? selectedChild : '';
        setSelectedChild(selected);
        if (roster.length) await loadHome(selected);
      }
    } catch (failure) {
      setPhase('unavailable');
      throw failure;
    }
  }

  async function loadHome(childId = selectedChild) {
    setHomeError('');
    try {
      setHome(await requestParent('/home' + (childId ? '?childId=' + encodeURIComponent(childId) : '')));
    } catch (failure) {
      setHome(null);
      setHomeError(failure.status === 404 ? 'Ce rattachement a changé. Actualisez votre accueil.'
        : 'Le suivi du jour est indisponible. Actualisez votre accueil.');
    }
  }

  function filterHome(id) {
    setSelectedChild(id);
    setHome(null);
    void run(() => loadHome(id));
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
    if (needsSchoolAddress) setAddress(await lastSchoolAddress());
    await load();
  }

  async function loadSchoolPanel(selection, append = false) {
    const showsAgenda = selection.kind === 'agenda';
    const key = showsAgenda ? 'events' : 'entries';
    const list = showsAgenda ? listAgenda : listHomework;
    const period = showsAgenda ? agendaRange(selection.anchor, selection.view) : {
      ...periodRange(selection.anchor, selection.view), domain: selection.domain, kind: selection.entryKind,
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
      let items = append ? [...selection[key], ...page[key]] : page[key];
      if (!append && selection.focusId) {
        const selected = items.find(({ id }) => id === selection.focusId)
          ?? await requestParent('/children/' + selection.child.id + '/' + selection.kind + '/' + selection.focusId);
        items = [selected, ...items.filter(({ id }) => id !== selected.id)];
      }
      const unique = Array.from(new Map(items.map((item) => [item.id, item])).values());
      setSchoolPanel({ ...selection, child: page.child, [key]: unique, nextCursor: page.nextCursor });
    } catch (failure) {
      if (failure.status !== 404) throw failure;
      await load();
      setError('Cet espace n’est plus accessible pour votre compte.');
    }
  }

  function openSchoolPanel(child, kind, anchor = dayInSchoolCalendar(), options) {
    setTutorReference(null);
    void run(() => loadSchoolPanel({ child, kind, anchor, view: 'week', domain: '', ...options }));
  }

  function openNotification(child) {
    const kind = notification;
    setNotification(null);
    if (kind === 'messages') {
      showParentSection('messages');
    } else if (kind === 'homework' || kind === 'assignments') {
      openSchoolPanel(child, 'homework', dayInSchoolCalendar(), { entryKind: kind === 'assignments' ? 'assignment' : 'notebook' });
    } else if (kind === 'agenda' || kind === 'agenda-reminder') {
      const day = kind === 'agenda-reminder' ? dayInSchoolCalendar(new Date(Date.now() + 86_400_000)) : dayInSchoolCalendar();
      openSchoolPanel(child, 'agenda', day);
    } else {
      const month = kind === 'attendance' ? dayInSchoolCalendar(new Date(Date.now() - 86_400_000)).slice(0, 7) : undefined;
      setSchoolPanel({ child, month });
      setPhase(kind);
    }
  }

  useEffect(() => {
    if (phase !== 'children' || busy || !notification) return;
    if (notification === 'messages' || children.length === 1) openNotification(children[0]);
    else if (!children.length) setNotification(null);
  }, [phase, busy, notification, children]);

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
      if (/^ENS-[A-Za-z0-9_-]{22}$/.test(invitation.trim()) && /^[A-Z0-9][A-Z0-9-]{1,31}$/.test(schoolCode)) {
        onStaff('teacher', { origin, schoolCode, code: invitation.trim() });
        return;
      }
      const pairCode = invitation.trim().toUpperCase();
      if (/^(PA|EN|DI)-[0-9]{8}$/.test(pairCode) && /^[A-Z0-9][A-Z0-9-]{1,31}$/.test(schoolCode)) {
        if (pairCode.startsWith('PA-')) {
          await signIn({ origin, schoolCode, code: pairCode, pairing: true });
          setInvitation('');
          await load(true);
        } else {
          onStaff(pairCode.startsWith('EN-') ? 'teacher' : 'direction', { origin, schoolCode, pairCode });
        }
        return;
      }
      const letters = invitation.toUpperCase().replaceAll(/[\s-]/g, '');
      if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(schoolCode) || !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(letters)) {
        setError('Vérifiez le code de l’école et le code d’accès remis par votre école.');
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
      setHome(null);
      setHomeError('');
      setSelectedChild('');
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
    setActivityId(null);
    setThreadId(null);
    setPhase(section);
    if (section === 'children' && children.length) void run(() => loadHome());
  }

  const menu = signedIn && <SectionNav label="Menu parent" busy={busy}
    active={['notifications', 'devices'].includes(phase) ? 'account' : ['messages', 'account'].includes(phase) ? phase : 'children'}
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
        <FirstRun token={installationToken} onDirection={(schoolCode) => onStaff('direction', { schoolCode })} onComplete={(result) => {
          setInstallationToken('');
          setSchool(result?.schoolCode ?? '');
          setInvitation(result?.code ?? '');
          setPhase('login');
        }} />
      )}

      {phase === 'login' && (
        <View style={styles.panel}>
          <Image source={welcomeImage} resizeMode="cover" accessible={false} aria-hidden style={shell.welcome} />
          <Text accessibilityRole="header" style={styles.title}>Connexion à l’ENT</Text>
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
            label="Code d’accès"
            value={invitation}
            onChangeText={setInvitation}
            autoCapitalize="none"
            secureTextEntry
            maxLength={32}
            onSubmitEditing={submit}
            returnKeyType="go"
            editable={!busy}
          />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Button label={busy ? 'Connexion…' : 'Se connecter'} icon="log-in-outline" busy={busy} onPress={submit} />
          <View style={styles.actions}>
            <Button label="Accès pour l’équipe" icon="people-outline" selected={staffOptions} secondary busy={busy}
              onPress={() => setStaffOptions(!staffOptions)} />
          </View>
          {staffOptions && <View style={styles.actions}>
            <Button label="Enseignant" secondary busy={busy} onPress={() => onStaff('teacher', { schoolCode: school, origin: address })} />
            <Button label="Direction" secondary busy={busy} onPress={() => onStaff('direction', { schoolCode: school, origin: address })} />
          </View>}
        </View>
      )}

      {phase === 'children' && (
        <>
          {!!children.length && <FamilyHome children={children} selected={selectedChild} onSelect={filterHome}
            data={home} busy={busy} problem={homeError}
            onAssignment={(item) => openSchoolPanel(item.child, 'homework', item.date, { entryKind: 'assignment', view: 'day', focusId: item.id })}
            onEvent={(item) => openSchoolPanel(item.child, 'agenda', dayInSchoolCalendar(new Date(item.startsAt)), { view: 'day', focusId: item.id })}
            onActivity={(item) => { setActivityId(item?.id ?? null); setPhase('activities'); }}
            onMessage={(item) => { setThreadId(item.id); setPhase('messages'); }} />}
          <View style={styles.panel}>
            <Text accessibilityRole="header" style={styles.title}>Vos enfants</Text>
            {notification && notification !== 'messages' && children.length > 1 && <View style={styles.field}>
              <Text style={styles.label}>{notificationLabels[notification]} · Choisir un enfant</Text>
              <View style={styles.actions}>
                {children.map((child) => <Button key={child.id} label={child.displayName}
                  busy={busy} secondary onPress={() => openNotification(child)} />)}
                <Button label="Fermer" secondary onPress={() => setNotification(null)} />
              </View>
            </View>}
            {children.length === 0 && <Text style={styles.body}>Aucun enfant n’est rattaché à votre compte. Contactez votre école.</Text>}
            {children.filter(({ id }) => !selectedChild || id === selectedChild).map((child) => (
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
        <Messages initialThreadId={threadId} children={children} request={requestMessages} refreshUnread={unread.refresh} onExpired={() => void run(load)} />
      </View>}

      {phase === 'activities' && <FamilyActivities request={requestParent} initialId={activityId}
        onBack={() => showParentSection('children')} onExpired={() => void run(load)} />}

      {phase === 'account' && <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>Mon compte</Text>
        <Button label="Paramètres de notification" icon="notifications-outline" secondary
          onPress={() => showParentSection('notifications')} />
        <Button label="Mes appareils" icon="phone-portrait-outline" secondary onPress={() => showParentSection('devices')} />
        <FamilyPhotoAuthorizations request={requestParent} run={run} busy={busy} onExpired={load} />
        <Text style={styles.body}>Votre référence tuteur permet à l’école de vous écrire ou de vous proposer un rendez-vous individuel.</Text>
        {tutorReference && <Text accessibilityLabel="Référence tuteur" selectable style={styles.label}>{tutorReference}</Text>}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <Button label={tutorReference ? 'Masquer ma référence tuteur' : 'Afficher ma référence tuteur'}
            icon={tutorReference ? 'eye-off-outline' : 'eye-outline'} busy={busy} onPress={toggleTutorReference} secondary />
        </View>
        {Platform.OS === 'web' && <AccountLink role="parent" request={requestParent}
          onOpen={() => onStaff('teacher')} onExpired={() => void run(load)} />}
      </View>}

      {phase === 'devices' && <View style={styles.panel}>
        <Button label="Retour au compte" secondary onPress={() => showParentSection('account')} />
        <DeviceSettings request={requestParent} onExpired={() => void run(load)} />
      </View>}

      {phase === 'notifications' && <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>Notifications</Text>
        <PushSettings request={requestParent} onExpired={() => void run(load)} />
      </View>}

      {phase === 'homework' && schoolPanel && (
        <Homework
          key={schoolPanel.child.id}
          notebook={schoolPanel}
          onChange={(selection) => void run(() => loadSchoolPanel(selection))}
          onMore={() => void run(() => loadSchoolPanel(schoolPanel, true))}
          onBack={() => void run(load)}
          onLogout={logout}
          onDocument={(id) => void run(async () => {
            const url = '/children/' + encodeURIComponent(schoolPanel.child.id) + '/homework/' + id + '/document';
            await downloadDocument(await requestParent(url, { responseType: 'attachment' }), 'cahier-de-texte');
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
        <>
          <FamilyPlannedAbsences key={schoolPanel.child.id} childId={schoolPanel.child.id} request={requestParent}
            onExpired={() => void run(load)} />
          <ParentAttendance key={schoolPanel.child.id} child={schoolPanel.child} request={requestParent}
            initialMonth={schoolPanel.month} onBack={() => showParentSection('children')} onExpired={() => void run(load)} />
        </>
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
  const [portal, setPortal] = useState(null);
  useNativeNotificationDestination((kind) => {
    if (kind === 'nouveaute' || Object.hasOwn(notificationLabels, kind)) {
      setPortal({ role: 'parent', notification: { kind } });
    }
  });
  useEffect(cleanupTemporaryDocuments, []);
  useEffect(() => {
    async function restore() {
      const url = Platform.OS === 'web' ? new URL(window.location.href) : null;
      const section = url?.searchParams.get('espace');
      const remembered = await lastAccessRole().catch(() => null);
      let role = 'parent';
      if (/^#(?:recuperation|verification)=/.test(url?.hash)) role = 'direction';
      else if (section !== 'parent' && !url?.searchParams.has('notification') && !/^#installation=/.test(url?.hash)) {
        const preferred = section === 'direction' ? 'direction' : section === 'enseignant' ? 'teacher' : remembered;
        if (preferred === 'direction' || preferred === 'teacher') role = preferred;
      }
      if (role !== 'parent' && section) void rememberAccessRole(role).catch(() => {});
      setPortal((current) => current ?? { role });
    }
    void restore();
  }, []);

  function open(role, access) {
    if (Platform.OS === 'web') {
      const url = new URL(window.location.href);
      url.searchParams.delete('espace');
      if (/^#(?:recuperation|verification)=/.test(url.hash)) url.hash = '';
      window.history.replaceState(window.history.state, '', url);
    }
    void rememberAccessRole(role === 'parent' ? null : role).catch(() => {});
    setPortal({ role, access });
  }

  return (
    <SafeAreaProvider>
      {!portal ? <AppFrame><ActivityIndicator accessibilityLabel="Chargement" color="#225344" /></AppFrame>
        : portal.role === 'parent' ? <ParentApp onStaff={open} requestedNotification={portal.notification} />
          : <Staff key={portal.role} role={portal.role} access={portal.access}
            onParent={() => open('parent')} onLogout={() => open('parent')} />}
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
