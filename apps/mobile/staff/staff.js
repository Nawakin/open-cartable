import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { dayInSchoolCalendar, movePeriod, periodRange } from '../parent/homework';
import { Button, Field, styles } from '../parent/ui';
import { staffNeedsSchoolAddress, staffProfile, staffRequest } from './api';
import { classPath } from './paths';
import { parseSchoolAddress } from '../parent/http';
import { lastSchoolAddress } from '../access/remember';
import { TeacherDirectory } from './teacher-directory';
import { StaffAgenda } from '../agenda/staff-agenda';
import { Messages } from '../messaging/messages';
import { useUnreadMessages } from '../messaging/unread';
import { AppFrame, SectionNav } from '../navigation';
import { StaffLiaison } from '../liaison/staff-liaison';
import { StaffBlog } from '../blog/staff-blog';
import { DirectionPhotoAuthorizations } from '../photo-authorizations/direction';
import { useSchoolBanner } from '../school-banner/session';
import { BannerSettings } from '../school-banner/settings';
import { TeacherAttendance } from '../attendance/teacher';
import { DirectionAttendance } from '../attendance/monthly';
import { YearTransition } from '../year-transition/year-transition';
import { AuthenticatorField, validCode } from '../direction-security/fields';
import { consumeRecoveryLink, DirectionRecovery } from '../direction-security/recovery';
import { DirectionSecurity, EnrollmentQr } from '../direction-security/settings';
import { AccountLink } from '../account-link';
import { Illustration, IllustratedMenu } from '../illustrations';
import { SchoolDirectory } from './school-directory';
import { StaffReports } from '../school-reports/reports';
import { downloadDocument, encodedFile, FileButton } from '../files/documents';
import { StaffLibrary } from '../files/library';

const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const emptyPage = { entries: [], nextCursor: null };
const blankEntry = () => ({ date: dayInSchoolCalendar(), title: '', domain: '', description: '', kind: 'notebook' });
const commonSections = [
  { id: 'homework', label: 'Cahier de texte' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'messages', label: 'Messagerie' },
];
const directionSections = [
  ...commonSections,
  { id: 'school', label: 'École' },
];
const teacherSections = [
  ...commonSections,
  { id: 'class-life', label: 'Vie de classe' },
];
const schoolPages = [
  { id: 'directory', label: 'Enseignants', detail: 'Gérer les comptes et les affectations.' },
  { id: 'enrolment', art: 'home', label: 'Classes et familles', detail: 'Gérer les élèves, les tuteurs et leurs invitations.' },
  { id: 'reports', art: 'homework', label: 'Livrets scolaires', detail: 'Consulter les bilans et télécharger les PDF.' },
  { id: 'library', art: 'blog', label: 'Médiathèque', detail: 'Consulter les documents, images et enregistrements de classe.' },
  { id: 'photo-authorizations', label: 'Autorisations photo', detail: 'Consulter et renseigner les décisions des familles.' },
  { id: 'banner', label: 'Bandeau d’en-tête', detail: 'Choisir le texte et les couleurs du bandeau.' },
  { id: 'attendance', label: 'Suivi des absences', detail: 'Consulter les absences par classe et leurs justifications.' },
  { id: 'year-transition', label: 'Clôture d’année', detail: 'Préparer la rentrée et exporter le blog en PDF.' },
  { id: 'security', label: 'Sécurité du compte', detail: 'Configurer la récupération et la double authentification.' },
];
const classLifePages = [
  { id: 'attendance', label: 'Faire l’appel', detail: 'Enregistrer les présences, retards et absences.' },
  { id: 'liaison', label: 'Cahier de liaison', detail: 'Publier un mot et lire les réponses des familles.' },
  { id: 'blog', label: 'Blog de classe', detail: 'Partager les articles et les galeries de la classe.' },
  { id: 'reports', art: 'homework', label: 'Livret scolaire', detail: 'Rédiger et publier les bilans par trimestre.' },
  { id: 'library', art: 'blog', label: 'Médiathèque', detail: 'Partager des documents, des images et des enregistrements.' },
];

function message(error, activating) {
  switch (error.status) {
    case 0: return 'Le serveur est inaccessible. Réessayez dans un instant.';
    case 400: return 'Vérifiez la date et le contenu des champs.';
    case 401: return activating ? 'Le code d’activation ou les identifiants sont invalides.' : 'Les identifiants sont incorrects.';
    case 404: return 'La ressource n’est plus accessible.';
    case 409: return 'Cet identifiant est déjà utilisé dans votre école.';
    case 413: return 'Le fichier dépasse la taille autorisée.';
    case 415: return 'Choisissez un fichier PDF, JPEG, PNG ou WebP valide.';
    case 422: return 'Saisissez le nouveau code à six chiffres affiché par votre authentificateur.';
    case 429: return 'Trop de tentatives. Réessayez dans une minute.';
    default: return 'L’opération n’a pas abouti. Réessayez dans un instant.';
  }
}

export function Staff({ role, access, onParent, onLogout }) {
  const isTeacher = role === 'teacher';
  const title = isTeacher ? 'Espace enseignant' : 'Espace direction';
  const request = useCallback((path, options) => staffRequest(role, path, options), [role]);
  const requestMessages = useCallback((path, options) => staffRequest(role, '/messages' + path, options), [role]);
  const [phase, setPhase] = useState('loading');
  const [section, setSection] = useState('homework');
  const [subpage, setSubpage] = useState(null);
  const [messageDraft, setMessageDraft] = useState(null);
  const [desk, setDesk] = useState(null);
  const [school, setSchool] = useState(access?.schoolCode ?? '');
  const [address, setAddress] = useState(access?.origin ?? '');
  const [teacherLogin, setTeacherLogin] = useState('');
  const [activationCode, setActivationCode] = useState(access?.code ?? '');
  const [activating, setActivating] = useState(Boolean(access?.code));
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [authCode, setAuthCode] = useState('');
  const [enrollment, setEnrollment] = useState(null);
  const [recovery, setRecovery] = useState(null);
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
  const { banner, replace: replaceBanner } = useSchoolBanner(request, phase === 'desk');

  function resetDesk() {
    setDesk(null);
    setMessageDraft(null);
    setSection('homework');
    setSubpage(null);
    resetClass();
    setPassword('');
    setNeedsCode(false);
    setAuthCode('');
    setEnrollment(null);
    setPhase('login');
  }

  function expireSession() {
    resetDesk();
    setPhase('loading');
    void restore().catch((error) => setProblem(message(error, activating)));
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
      const accessState = await request('/auth/state');
      setSchool((current) => accessState.schoolCode ?? current);
      if (accessState.state === 'enroll') {
        setPhase('enroll');
        setEnrollment(await request('/auth/enrollment', { method: 'POST' }));
        return;
      }
      if (accessState.state === 'verify') {
        resetDesk();
        setPhase('verify');
        return;
      }
      if (accessState.state !== 'active') { resetDesk(); return; }
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
    void run(async () => {
      const profile = await staffProfile(role);
      setAddress(access?.origin || profile?.origin || await lastSchoolAddress());
      setSchool(access?.schoolCode || profile?.schoolCode || '');
      if (access?.code) setPhase('login');
      else await restore();
    });
  }, []);

  useEffect(() => {
    if (isTeacher || typeof window === 'undefined') return undefined;
    function openRecovery() {
      const flow = consumeRecoveryLink();
      if (flow) setRecovery(flow);
    }
    openRecovery();
    window.addEventListener('hashchange', openRecovery);
    return () => window.removeEventListener('hashchange', openRecovery);
  }, [isTeacher]);

  useEffect(() => {
    if (phase !== 'desk') return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void run(async () => {
        if (isTeacher) await request('/auth/state');
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
      const origin = staffNeedsSchoolAddress ? parseSchoolAddress(address) : undefined;
      if (staffNeedsSchoolAddress && !origin) {
        setProblem('Saisissez l’adresse HTTPS de votre école, sans chemin.');
        return;
      }
      if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(schoolCode) || !password.trim() || length < 15 || length > 128) {
        setProblem('Renseignez le code de l’école et un mot de passe de 15 à 128 caractères.');
        return;
      }
      if (isTeacher && !activating && !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(login)) {
        setProblem('Saisissez l’identifiant transmis par la direction.');
        return;
      }
      if (activating) {
        const code = activationCode.trim();
        if (!/^ENS-[A-Za-z0-9_-]{22}$/.test(code) || password !== confirmation) {
          setProblem('Vérifiez le code d’activation et la confirmation du mot de passe.');
          return;
        }
        await request('/auth/claim', { origin, method: 'POST', body: { schoolCode, code, password } });
        setActivating(false);
        setActivationCode('');
        setPassword('');
        setConfirmation('');
        await restore();
        return;
      }
      if (needsCode && !validCode(authCode)) {
        setProblem('Saisissez les six chiffres affichés par votre authentificateur.');
        return;
      }
      const body = isTeacher ? { schoolCode, login, password }
        : { schoolCode, password, ...(needsCode ? { code: authCode } : {}) };
      try {
        await request('/auth/login', { origin, method: 'POST', body });
      } catch (error) {
        if (!isTeacher && error.status === 428) {
          setNeedsCode(true);
          return;
        }
        if (needsCode && error.status === 401) {
          setAuthCode('');
          setProblem('Vérifiez vos identifiants et saisissez un nouveau code de l’authentificateur.');
          return;
        }
        throw error;
      }
      setPassword('');
      setAuthCode('');
      setNeedsCode(false);
      await restore();
    });
  }

  function completeFactor() {
    void run(async () => {
      const enrolling = phase === 'enroll';
      const code = authCode;
      setAuthCode('');
      try {
        await request(enrolling ? '/auth/enrollment' : '/auth/resume', { method: enrolling ? 'PUT' : 'POST', body: { code } });
      } catch (error) {
        if (error.status !== 401) throw error;
        await restore();
        setProblem('Cet accès a expiré. Saisissez de nouveau les identifiants de l’école.');
        return;
      }
      setEnrollment(null);
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
    const { id, date, title, domain, description, kind = 'notebook' } = entry;
    setEditing(id);
    setRemoving(null);
    setDraft({ date, title, domain, description, kind });
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
      onLogout?.();
    });
  }

  const menu = phase === 'desk' && <SectionNav label={isTeacher ? 'Menu enseignant' : 'Menu direction'} active={section} busy={busy}
    items={(isTeacher ? teacherSections : directionSections).map((item) => ({
      ...item, unreadCount: item.id === 'messages' ? unread.count : 0,
      onPress: () => { setMessageDraft(null); setSubpage(null); setSection(item.id); },
    }))} />;
  const schoolGroup = !isTeacher && section === 'school';
  const classLifeGroup = isTeacher && section === 'class-life';
  const subpages = schoolGroup ? schoolPages : (classLifeGroup ? classLifePages : null);
  const panel = (
    <View style={styles.panel}>
      {phase === 'desk' ? !subpages && <Text accessibilityRole="header" style={staffStyles.heading}>{desk.schoolName}</Text>
        : <Text accessibilityRole="header" style={styles.title}>{title}</Text>}
      {problem ? <Text accessibilityRole="alert" style={styles.error}>{problem}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text> : null}
      {phase === 'loading' && <Text style={styles.body}>Chargement de votre espace…</Text>}
      {phase === 'unavailable' && <Button label="Réessayer" onPress={() => void run(restore)} busy={busy} />}
      {(phase === 'enroll' || phase === 'verify') && <>
        {phase === 'enroll' ? <>
          <Text style={styles.label}>Configurer la double authentification</Text>
          {enrollment ? <>
            <Text style={styles.body}>{Platform.OS === 'web'
              ? 'Scannez le QR code avec Aegis, ente Auth ou un autre authentificateur TOTP.'
              : 'Ajoutez cette clé dans Aegis, ente Auth ou un autre authentificateur TOTP.'}</Text>
            <EnrollmentQr uri={enrollment.uri} />
            <Text style={styles.label}>Clé à saisir dans l’authentificateur</Text>
            <Text accessibilityLabel="Clé de l’authentificateur" selectable style={styles.body}>{enrollment.secret}</Text>
          </> : <Button label="Afficher la clé" secondary busy={busy} onPress={() => void run(restore)} />}
        </> : <Text style={styles.body}>Saisissez le code de l’authentificateur pour retrouver l’espace direction de {school}.</Text>}
        {(phase === 'verify' || enrollment) && <>
          <AuthenticatorField value={authCode} onChangeText={setAuthCode} editable={!busy} onSubmitEditing={completeFactor} />
          <Button label={phase === 'enroll' ? 'Activer et ouvrir la direction' : 'Ouvrir la direction'}
            icon="shield-checkmark-outline" busy={busy || !validCode(authCode)} onPress={completeFactor} />
        </>}
        <Button label="Oublier cet accès et revenir à la connexion" secondary busy={busy} onPress={logout} />
      </>}
      {phase === 'login' && (
        <>
          {staffNeedsSchoolAddress && <Field label="Adresse de l’école" value={address} onChangeText={setAddress} autoCapitalize="none"
            keyboardType="url" placeholder="https://ent.ecole.example" maxLength={512} editable={!busy} />}
          <Field label="Code de l’école" value={school} onChangeText={setSchool}
            autoCapitalize="characters" maxLength={32} editable={!busy} />
          {isTeacher && !activating && <Field label="Identifiant enseignant" value={teacherLogin} onChangeText={setTeacherLogin}
            autoCapitalize="none" autoComplete="username" maxLength={32} editable={!busy} />}
          {activating && <Field label="Code d’activation" value={activationCode} onChangeText={setActivationCode}
            autoCapitalize="none" maxLength={26} editable={!busy} secureTextEntry />}
          <Field label={isTeacher ? 'Mot de passe enseignant' : 'Mot de passe direction'} value={password} onChangeText={setPassword}
            secureTextEntry autoCapitalize="none" autoComplete={activating ? 'new-password' : 'current-password'}
            maxLength={256} editable={!busy} onSubmitEditing={login} />
          {activating && <Field label="Confirmer le mot de passe" value={confirmation} onChangeText={setConfirmation}
            secureTextEntry autoCapitalize="none" autoComplete="new-password" maxLength={256} editable={!busy} onSubmitEditing={login} />}
          {needsCode && <AuthenticatorField value={authCode} onChangeText={setAuthCode} editable={!busy} autoFocus onSubmitEditing={login} />}
          <Button label={activating ? 'Activer le compte' : (isTeacher ? 'Se connecter comme enseignant' : 'Se connecter à la direction')}
            onPress={login} busy={busy} />
          {isTeacher && <Button label={activating ? 'Revenir à la connexion' : 'Activer mon compte'} busy={busy} secondary
            onPress={() => { setActivating(!activating); setPassword(''); setConfirmation(''); setActivationCode(''); setProblem(''); setNotice(''); }} />}
          {!isTeacher && <Button label="Mot de passe oublié ?" busy={busy} secondary onPress={() => {
            if (staffNeedsSchoolAddress && !parseSchoolAddress(address)) {
              setProblem('Saisissez l’adresse HTTPS de votre école.');
              return;
            }
            setPassword(''); setAuthCode(''); setNeedsCode(false); setRecovery({ phase: 'request' });
          }} />}
          <Button label="Retour à la connexion" icon="arrow-back-outline" onPress={onParent} busy={busy} secondary />
        </>
      )}
      {phase === 'desk' && (
        <>
          {subpages && <>
            {subpage ? <View style={styles.actions}>
              <Button label="Retour" accessibilityLabel={schoolGroup ? 'Retour à École' : 'Retour à Vie de classe'} icon="arrow-back-outline"
                secondary busy={busy} onPress={() => setSubpage(null)} />
            </View> : <>
              <View style={staffStyles.overview}>
                <Illustration name={schoolGroup ? 'school' : 'class-life'} size={64} />
                <View style={staffStyles.overviewCopy}>
                  <Text style={styles.label}>{desk.schoolName}</Text>
                  <Text accessibilityRole="header" style={styles.title}>{schoolGroup ? 'Gérer l’école' : 'Vie de classe'}</Text>
                </View>
              </View>
              <IllustratedMenu items={subpages.map((item) => ({ ...item, onPress: () => setSubpage(item.id) }))} busy={busy} />
              {classLifeGroup && Platform.OS === 'web' && <View style={styles.actions}>
                <Button label="Mes accès" icon="link-outline" secondary busy={busy} onPress={() => setSubpage('account-link')} />
              </View>}
            </>}
            {schoolGroup && subpage === 'directory' && <TeacherDirectory classes={desk.classes} request={request} run={run} busy={busy} schoolAddress={address} />}
            {schoolGroup && subpage === 'enrolment' && <SchoolDirectory request={request} run={run} busy={busy} onChanged={restore} />}
            {subpage === 'reports' && <StaffReports classes={desk.classes} request={request} onExpired={expireSession} teacher={isTeacher} />}
            {subpage === 'library' && <StaffLibrary classes={desk.classes} request={request} onExpired={expireSession} role={role} />}
            {schoolGroup && subpage === 'photo-authorizations' && <DirectionPhotoAuthorizations classes={desk.classes}
              request={request} run={run} busy={busy} />}
            {schoolGroup && subpage === 'banner' && <BannerSettings request={request} run={run} busy={busy} onSaved={replaceBanner} />}
            {schoolGroup && subpage === 'attendance' && <DirectionAttendance classes={desk.classes} request={request} onExpired={expireSession} />}
            {schoolGroup && subpage === 'year-transition' && <YearTransition classes={desk.classes}
              request={request} onExpired={expireSession} onApplied={() => void run(restore)} />}
            {schoolGroup && subpage === 'security' && <DirectionSecurity request={request} onExpired={expireSession} />}
            {classLifeGroup && subpage === 'attendance' && <TeacherAttendance classes={desk.classes} request={request} onExpired={expireSession} />}
            {classLifeGroup && subpage === 'account-link' && Platform.OS === 'web' && <AccountLink role="teacher" request={request}
              onExpired={expireSession} onOpen={onParent} />}
            {classLifeGroup && subpage === 'liaison' && <StaffLiaison classes={desk.classes} request={request} onExpired={expireSession}
              onReply={(target) => { setMessageDraft(target); setSubpage(null); setSection('messages'); }} />}
            {classLifeGroup && subpage === 'blog' && <StaffBlog classes={desk.classes} request={request} onExpired={expireSession} />}
          </>}
          {section === 'agenda' && <StaffAgenda classes={desk.classes} isTeacher={isTeacher} request={request} run={run} busy={busy} />}
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
                  <View style={styles.actions}>
                    {[['notebook', 'Note de classe'], ['assignment', 'Devoir à rendre']].map(([kind, label]) =>
                      <Button key={kind} label={label} selected={draft.kind === kind} secondary={draft.kind !== kind}
                        busy={busy} onPress={() => setDraft({ ...draft, kind })} />)}
                  </View>
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
                      <Text style={styles.body}>{entry.kind === 'assignment' ? 'À rendre · ' : ''}{entry.date} · {entry.domain}</Text>
                      <Text accessibilityRole="header" style={staffStyles.heading}>{entry.title}</Text>
                      <Text style={styles.body}>{entry.description}</Text>
                      <View style={styles.actions}>
                        <FileButton label={entry.hasDocument ? 'Remplacer le document' : 'Joindre un document'} busy={busy}
                          onFile={(file) => void run(async () => {
                            await request(classPath(classId) + '/' + entry.id + '/document',
                              { method: 'PUT', body: { content: await encodedFile(file) } });
                            await list(classId, month);
                          })} />
                        {entry.hasDocument && <Button label="Télécharger le document" secondary busy={busy} onPress={() => void run(async () => {
                          const file = await request(classPath(classId) + '/' + entry.id + '/document', { responseType: 'attachment' });
                          downloadDocument(file, 'document-cahier-de-texte');
                        })} />}
                        {entry.hasDocument && <Button label="Retirer le document" secondary busy={busy} onPress={() => void run(async () => {
                          await request(classPath(classId) + '/' + entry.id + '/document', { method: 'DELETE' });
                          await list(classId, month);
                        })} />}
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

  if (recovery) return <AppFrame scrollKey={recovery.phase} busy={busy}>
    <DirectionRecovery key={recovery.token ?? recovery.phase} flow={recovery} school={school}
      request={(path, options) => request(path, { ...options, ...(staffNeedsSchoolAddress ? { origin: parseSchoolAddress(address) } : {}) })} onBack={(reset) => {
      setRecovery(null);
      if (reset) resetDesk();
      else void run(restore);
    }} />
  </AppFrame>;

  return (
    <AppFrame menu={menu} scrollKey={phase === 'desk' ? (subpage ?? section) : phase} busy={busy} banner={banner}
      roleLabel={phase === 'desk' ? title : undefined} onLogout={phase === 'desk' ? logout : undefined}
      wide={phase === 'desk' && Boolean(subpages) && !subpage}>
      {panel}
    </AppFrame>
  );
}

const staffStyles = StyleSheet.create({
  heading: { color: '#132d25', fontSize: 19, fontWeight: '700' },
  overview: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 4 },
  overviewCopy: { flex: 1, minWidth: 0, gap: 3 },
  description: { minHeight: 110, textAlignVertical: 'top' },
  entry: { padding: 16, borderRadius: 12, backgroundColor: '#eef1e9', gap: 8 },
});
