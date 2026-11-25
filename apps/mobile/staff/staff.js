import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { dayInSchoolCalendar, movePeriod, periodRange } from '../parent/homework';
import { Button, Field, styles } from '../parent/ui';
import { classPath, staffRequest } from './api';
import { TeacherDirectory } from './teacher-directory';
import { StaffAgenda } from '../agenda/staff-agenda';
import { Messages } from '../messaging/messages';
import { useUnreadMessages } from '../messaging/unread';
import { AppFrame, SectionNav } from '../navigation';
import { StaffLiaison } from '../liaison/staff-liaison';

const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const emptyPage = { entries: [], nextCursor: null };
const blankEntry = () => ({ date: dayInSchoolCalendar(), title: '', domain: '', description: '' });
const commonSections = [
  { id: 'homework', icon: 'book-outline', label: 'Cahier de texte' },
  { id: 'agenda', icon: 'calendar-outline', label: 'Agenda' },
  { id: 'messages', icon: 'chatbubbles-outline', label: 'Messagerie' },
];
const directionSections = [
  ...commonSections,
  { id: 'directory', icon: 'people-outline', label: 'Enseignants' },
];
const teacherSections = [
  ...commonSections,
  { id: 'liaison', icon: 'reader-outline', label: 'Cahier de liaison' },
];

function message(error, activating) {
  switch (error.status) {
    case 0: return 'Le serveur est inaccessible. Réessayez dans un instant.';
    case 400: return 'Vérifiez la date et le contenu des champs.';
    case 401: return activating ? 'Le code d’activation ou les identifiants sont invalides.' : 'Les identifiants sont incorrects.';
    case 404: return 'La ressource n’est plus accessible.';
    case 409: return 'Cet identifiant est déjà utilisé dans votre école.';
    case 429: return 'Trop de tentatives. Réessayez dans une minute.';
    default: return 'L’opération n’a pas abouti. Réessayez dans un instant.';
  }
}

export function Staff({ role, onParent, onOtherStaff }) {
  const isTeacher = role === 'teacher';
  const title = isTeacher ? 'Espace enseignant' : 'Espace direction';
  const request = (path, options) => staffRequest(role, path, options);
  const requestMessages = useCallback((path, options) => staffRequest(role, '/messages' + path, options), [role]);
  const [phase, setPhase] = useState('loading');
  const [section, setSection] = useState('homework');
  const [messageDraft, setMessageDraft] = useState(null);
  const [desk, setDesk] = useState(null);
  const [school, setSchool] = useState('');
  const [teacherLogin, setTeacherLogin] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [activating, setActivating] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [classId, setClassId] = useState(null);
  const [month, setMonth] = useState(dayInSchoolCalendar);
  const [page, setPage] = useState(emptyPage);
  const [draft, setDraft] = useState(blankEntry);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const inProgress = useRef(false);
  const unread = useUnreadMessages(requestMessages, phase === 'desk');

  function resetDesk() {
    setDesk(null);
    setMessageDraft(null);
    setSection('homework');
    resetClass();
    setPassword('');
    setPhase('login');
  }

  function expireSession() {
    resetDesk();
    setProblem('Votre session a expiré. Reconnectez-vous.');
  }

  function resetClass() {
    setClassId(null);
    setPage(emptyPage);
    setEditing(null);
    setRemoving(null);
    setDraft(blankEntry());
  }

  async function run(operation) {
    if (inProgress.current) return;
    inProgress.current = true;
    setBusy(true);
    setProblem('');
    setNotice('');
    try {
      await operation();
    } catch (error) {
      if (error.status === 401 && phase === 'desk') {
        expireSession();
      } else {
        if (isTeacher && phase === 'desk' && error.status === 404) {
          resetClass();
          await restore().catch(() => {});
        }
        setProblem(message(error, activating));
      }
    } finally {
      inProgress.current = false;
      setBusy(false);
    }
  }

  async function restore() {
    try {
      setDesk(await request('/classes'));
      setPhase('desk');
    } catch (error) {
      if (error.status === 401) {
        resetDesk();
        return;
      }
      setPhase('unavailable');
      throw error;
    }
  }

  useEffect(() => {
    void run(restore);
  }, []);

  useEffect(() => {
    if (!isTeacher || phase !== 'desk') return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void run(async () => {
        const current = await request('/classes');
        setDesk(current);
        if (section !== 'homework' || !classId) return;
        if (!current.classes.some(({ id }) => id === classId)) {
          resetClass();
          return;
        }
        await list(classId, month);
      });
    });
    return () => subscription.remove();
  }, [isTeacher, phase, section, classId, month]);

  function login() {
    void run(async () => {
      const schoolCode = school.trim().toUpperCase();
      const length = [...password].length;
      const login = teacherLogin.trim().toLowerCase();
      if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(schoolCode) || !password.trim() || length < 15 || length > 128) {
        setProblem('Renseignez le code de l’école et un mot de passe de 15 à 128 caractères.');
        return;
      }
      if (isTeacher && !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(login)) {
        setProblem('Saisissez l’identifiant transmis par la direction.');
        return;
      }
      if (activating) {
        const code = activationCode.trim();
        if (!/^ENS-[A-Za-z0-9_-]{22}$/.test(code) || password !== confirmation) {
          setProblem('Vérifiez le code d’activation et la confirmation du mot de passe.');
          return;
        }
        await request('/auth/activate', { method: 'POST', body: { schoolCode, login, code, password } });
        setActivating(false);
        setActivationCode('');
        setPassword('');
        setConfirmation('');
        setNotice('Compte activé. Connectez-vous avec votre mot de passe.');
        return;
      }
      const body = isTeacher ? { schoolCode, login, password } : { schoolCode, password };
      await request('/auth/login', { method: 'POST', body });
      setPassword('');
      await restore();
    });
  }

  async function list(id, anchor, cursor) {
    const search = new URLSearchParams(periodRange(anchor, 'month'));
    if (cursor) search.set('cursor', cursor);
    const result = await request(`${classPath(id)}?${search}`);
    if (!cursor) {
      setPage(result);
      return;
    }
    setPage((before) => ({
      entries: Array.from(new Map([...before.entries, ...result.entries].map((entry) => [entry.id, entry])).values()),
      nextCursor: result.nextCursor,
    }));
  }

  function choose(id) {
    void run(async () => {
      setClassId(id);
      setEditing(null);
      setRemoving(null);
      setDraft(blankEntry());
      setPage(emptyPage);
      await list(id, month);
    });
  }

  function shift(offset) {
    void run(async () => {
      const target = movePeriod(month, 'month', offset);
      setMonth(target);
      setPage(emptyPage);
      setRemoving(null);
      await list(classId, target);
    });
  }

  function edit(entry) {
    const { id, date, title, domain, description } = entry;
    setEditing(id);
    setRemoving(null);
    setDraft({ date, title, domain, description });
  }

  function save() {
    void run(async () => {
      const target = editing ? `${classPath(classId)}/${editing}` : classPath(classId);
      await request(target, { method: editing ? 'PUT' : 'POST', body: draft });
      const savedDate = draft.date;
      setMonth(savedDate);
      setNotice(editing ? 'Modification enregistrée.' : 'Entrée publiée.');
      setEditing(null);
      setDraft(blankEntry());
      setRemoving(null);
      setPage(emptyPage);
      await list(classId, savedDate);
    });
  }

  function remove(entryId) {
    void run(async () => {
      await request(`${classPath(classId)}/${entryId}`, { method: 'DELETE' });
      setRemoving(null);
      if (editing === entryId) {
        setEditing(null);
        setDraft(blankEntry());
      }
      setPage((before) => ({ ...before, entries: before.entries.filter(({ id }) => id !== entryId) }));
      setNotice('Entrée retirée.');
      await list(classId, month);
    });
  }

  function logout() {
    void run(async () => {
      await request('/auth/logout', { method: 'POST' });
      resetDesk();
    });
  }

  const menu = phase === 'desk' && <SectionNav label={isTeacher ? 'Menu enseignant' : 'Menu direction'} active={section} busy={busy}
    items={(isTeacher ? teacherSections : directionSections).map((item) => ({
      ...item, unreadCount: item.id === 'messages' ? unread.count : 0,
      onPress: () => { setMessageDraft(null); setSection(item.id); },
    }))} />;
  const spaceLinks = <View style={styles.actions}>
    <Button label="Espace parent" icon="home-outline" onPress={onParent} busy={busy} secondary />
    <Button label={isTeacher ? 'Espace direction' : 'Espace enseignant'} icon={isTeacher ? 'business-outline' : 'school-outline'}
      onPress={onOtherStaff} busy={busy} secondary />
  </View>;

  const panel = (
    <View style={styles.panel}>
      {phase === 'desk'
        ? <Text accessibilityRole="header" style={staffStyles.heading}>{desk.schoolName}</Text>
        : <Text accessibilityRole="header" style={styles.title}>{title}</Text>}
      {problem ? <Text accessibilityRole="alert" style={styles.error}>{problem}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text> : null}
      {phase === 'loading' && <Text style={styles.body}>Chargement de votre espace…</Text>}
      {phase === 'unavailable' && <Button label="Réessayer" onPress={() => void run(restore)} busy={busy} />}
      {phase === 'login' && (
        <>
          <Field label="Code de l’école" value={school} onChangeText={setSchool}
            autoCapitalize="characters" maxLength={32} editable={!busy} />
          {isTeacher && <Field label="Identifiant enseignant" value={teacherLogin} onChangeText={setTeacherLogin}
            autoCapitalize="none" autoComplete="username" maxLength={32} editable={!busy} />}
          {activating && <Field label="Code d’activation" value={activationCode} onChangeText={setActivationCode}
            autoCapitalize="none" maxLength={26} editable={!busy} secureTextEntry />}
          <Field label={isTeacher ? 'Mot de passe enseignant' : 'Mot de passe direction'} value={password} onChangeText={setPassword}
            secureTextEntry autoCapitalize="none" autoComplete={activating ? 'new-password' : 'current-password'}
            maxLength={256} editable={!busy} onSubmitEditing={login} />
          {activating && <Field label="Confirmer le mot de passe" value={confirmation} onChangeText={setConfirmation}
            secureTextEntry autoCapitalize="none" autoComplete="new-password" maxLength={256} editable={!busy} onSubmitEditing={login} />}
          <Button label={activating ? 'Activer le compte' : (isTeacher ? 'Se connecter comme enseignant' : 'Se connecter à la direction')}
            onPress={login} busy={busy} />
          {isTeacher && <Button label={activating ? 'Revenir à la connexion' : 'Activer mon compte'} busy={busy} secondary
            onPress={() => { setActivating(!activating); setPassword(''); setConfirmation(''); setActivationCode(''); setProblem(''); setNotice(''); }} />}
        </>
      )}
      {phase === 'desk' && (
        <>
          {section === 'directory' && <TeacherDirectory classes={desk.classes} request={request} run={run} busy={busy} />}
          {section === 'agenda' && <StaffAgenda classes={desk.classes} isTeacher={isTeacher} request={request} run={run} busy={busy} />}
          {isTeacher && section === 'liaison' && <StaffLiaison classes={desk.classes} request={request} onExpired={expireSession}
            onReply={(target) => { setMessageDraft(target); setSection('messages'); }} />}
          {section === 'messages' && <Messages role={role} classes={desk.classes} request={requestMessages} refreshUnread={unread.refresh}
            initialDraft={messageDraft}
            loadStudents={(id) => request('/classes/' + encodeURIComponent(id) + '/appointments/students')}
            onExpired={expireSession} />}
          {section === 'homework' && (
            <>
              {desk.classes.length === 0 && <Text style={styles.body}>{isTeacher ? 'Aucune classe ne vous est affectée.' : 'Aucune classe n’est configurée.'}</Text>}
              {desk.classes.length > 0 && <Text style={styles.label}>Classe</Text>}
              <View style={styles.actions}>
                {desk.classes.map(({ id, name }) => (
                  <Button key={id} label={name} busy={busy} secondary={id !== classId} onPress={() => choose(id)} />
                ))}
              </View>
              {classId && (
                <>
                  <Text accessibilityRole="header" style={staffStyles.heading}>{editing ? 'Modifier l’entrée' : 'Publier une entrée'}</Text>
                  <Field label="Date" value={draft.date} onChangeText={(date) => setDraft({ ...draft, date })} placeholder="AAAA-MM-JJ" maxLength={10} editable={!busy} />
                  <Field label="Titre" value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} maxLength={120} editable={!busy} />
                  <Field label="Domaine" value={draft.domain} onChangeText={(domain) => setDraft({ ...draft, domain })} maxLength={80} editable={!busy} />
                  <Field label="Description" value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })}
                    maxLength={2500} multiline style={[styles.input, staffStyles.description]} editable={!busy} />
                  <View style={styles.actions}>
                    <Button label={editing ? 'Enregistrer' : 'Publier'} onPress={save} busy={busy} />
                    {editing && <Button label="Annuler la modification" onPress={() => { setEditing(null); setDraft(blankEntry()); }} busy={busy} secondary />}
                  </View>

                  <Text accessibilityRole="header" style={staffStyles.heading}>Publications · {monthLabel.format(new Date(month + 'T00:00:00Z'))}</Text>
                  <View style={styles.actions}>
                    <Button label="Mois précédent" onPress={() => shift(-1)} busy={busy} secondary />
                    <Button label="Mois suivant" onPress={() => shift(1)} busy={busy} secondary />
                    <Button label="Actualiser" onPress={() => void run(() => list(classId, month))} busy={busy} secondary />
                  </View>
                  {!busy && page.entries.length === 0 && <Text style={styles.body}>Aucune publication pour ce mois.</Text>}
                  {page.entries.map((entry) => (
                    <View key={entry.id} style={staffStyles.entry}>
                      <Text style={styles.body}>{entry.date} · {entry.domain}</Text>
                      <Text accessibilityRole="header" style={staffStyles.heading}>{entry.title}</Text>
                      <Text style={styles.body}>{entry.description}</Text>
                      <View style={styles.actions}>
                        {removing === entry.id ? (
                          <>
                            <Button label="Confirmer le retrait" busy={busy} onPress={() => remove(entry.id)} />
                            <Button label="Annuler le retrait" onPress={() => setRemoving(null)} busy={busy} secondary />
                          </>
                        ) : (
                          <>
                            <Button label="Modifier" accessibilityLabel={`Modifier ${entry.title}`} busy={busy} onPress={() => edit(entry)} secondary />
                            <Button label="Retirer" accessibilityLabel={`Retirer ${entry.title}`} busy={busy} onPress={() => setRemoving(entry.id)} secondary />
                          </>
                        )}
                      </View>
                    </View>
                  ))}
                  {page.nextCursor && <Button label="Afficher la suite" onPress={() => void run(() => list(classId, month, page.nextCursor))} busy={busy} secondary />}
                </>
              )}
            </>
          )}
        </>
      )}
    </View>
  );

  return (
    <AppFrame menu={menu} scrollKey={phase === 'desk' ? section : phase} busy={busy}
      onLogout={phase === 'desk' ? logout : undefined} wide>
      {panel}
      {spaceLinks}
    </AppFrame>
  );
}

const staffStyles = StyleSheet.create({
  heading: { color: '#132d25', fontSize: 19, fontWeight: '700' },
  description: { minHeight: 110, textAlignVertical: 'top' },
  entry: { padding: 16, borderRadius: 12, backgroundColor: '#eef1e9', gap: 8 },
});
