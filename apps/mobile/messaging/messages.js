import React, { useEffect, useRef, useState } from 'react';
import { downloadDocument, encodedFile, FileButton } from '../files/documents';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Field, styles } from '../parent/ui';

const collection = '/conversations';
const emptyInbox = { conversations: [], nextCursor: null };
const inboxView = { kind: 'inbox' };
const dateLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const tutorReferencePattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function contactLabel(conversation) {
  return conversation.channel === 'teacher' ? conversation.teacherLabel : 'Direction';
}

function conversationPath(id) {
  return collection + '/' + encodeURIComponent(id);
}

function paged(path, cursor) {
  return cursor ? path + '?cursor=' + encodeURIComponent(cursor) : path;
}

function appendById(before, after) {
  return Array.from(new Map([...before, ...after].map((item) => [item.id, item])).values());
}

function messageError(error, sending) {
  switch (error.status) {
    case 0: return sending
      ? 'La connexion a été interrompue. Actualisez la conversation avant de renvoyer le message.'
      : 'Le serveur est inaccessible. Vérifiez votre connexion et actualisez.';
    case 400: return 'Vérifiez le texte et la longueur des champs.';
    case 404: return 'Cette conversation ou ce destinataire n’est plus accessible. Vérifiez le lien avec l’élève.';
    default: return 'L’opération a échoué. Réessayez dans un instant.';
  }
}

export function Messages({ request, role = 'parent', children = [], classes = [], loadStudents, refreshUnread, onExpired, initialDraft }) {
  const isParent = role === 'parent';
  const isTeacher = role === 'teacher';
  const canStart = isParent ? children.length > 0 : isTeacher && classes.length > 0;
  const [view, setView] = useState(initialDraft ? { kind: 'compose' } : inboxView);
  const [inbox, setInbox] = useState(null);
  const [thread, setThread] = useState(null);
  const [childId, setChildId] = useState(initialDraft?.childId ?? null);
  const [teachers, setTeachers] = useState(null);
  const [recipient, setRecipient] = useState(null);
  const [classId, setClassId] = useState(initialDraft?.classId ?? null);
  const [students, setStudents] = useState(initialDraft ? [{ id: initialDraft.childId, displayName: initialDraft.studentName }] : null);
  const [guardianReference, setGuardianReference] = useState(initialDraft?.guardianReference ?? '');
  const [subject, setSubject] = useState(initialDraft?.subject ?? '');
  const [body, setBody] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const inProgress = useRef(false);
  const lastMarkedMessage = useRef(null);

  async function run(operation, { sending = false } = {}) {
    if (inProgress.current) return;
    inProgress.current = true;
    setBusy(true);
    setProblem('');
    setNotice('');
    try {
      await operation();
    } catch (error) {
      if (error.status === 401) {
        onExpired();
      } else {
        if (error.status === 404 && view.kind === 'thread') {
          setThread(null);
          setBody('');
          setAttachment(null);
        }
        setProblem(messageError(error, sending));
      }
    } finally {
      inProgress.current = false;
      setBusy(false);
    }
  }

  async function loadInbox(cursor) {
    const result = await request(paged(collection, cursor));
    setInbox((before) => cursor
      ? { ...result, conversations: appendById(before.conversations, result.conversations) }
      : result);
    if (!cursor) refreshUnread();
  }

  async function loadThread(id, cursor) {
    const result = await request(paged(conversationPath(id), cursor));
    setThread((before) => cursor
      ? { ...result, messages: appendById(before.messages, result.messages) }
      : result);
  }

  function openThread(id) {
    setView({ kind: 'thread', id });
    setThread(null);
    setBody('');
    setAttachment(null);
    void run(() => loadThread(id));
  }

  function goToInbox() {
    setView(inboxView);
    setThread(null);
    setSubject('');
    setBody('');
    setAttachment(null);
    void run(() => loadInbox());
  }

  function startConversation() {
    setChildId(null);
    setTeachers(null);
    setRecipient(null);
    setClassId(null);
    setStudents(null);
    setGuardianReference('');
    setSubject('');
    setBody('');
    setAttachment(null);
    setNotice('');
    setProblem('');
    setView({ kind: 'compose' });
    if (isParent && children.length === 1) chooseChild(children[0].id);
    if (isTeacher && classes.length === 1) chooseClass(classes[0].id);
  }

  function chooseChild(id) {
    setChildId(id);
    setTeachers(null);
    setRecipient(null);
    void run(async () => {
      const result = await request('/recipients/' + encodeURIComponent(id));
      setTeachers(result.teachers);
      if (!result.teachers.length) setRecipient('direction');
    });
  }

  function chooseClass(id) {
    setClassId(id);
    setStudents(null);
    setChildId(null);
    setGuardianReference('');
    void run(async () => {
      const result = await loadStudents(id);
      setStudents(result.students);
      if (result.students.length === 1) setChildId(result.students[0].id);
    });
  }

  const reference = guardianReference.trim().toLowerCase();
  const readyToCompose = Boolean(childId && subject.trim() && (body.trim() || attachment)
    && (isParent ? recipient : tutorReferencePattern.test(reference)));

  function send() {
    if (!body.trim() && !attachment) return;
    if (view.kind === 'compose' && !readyToCompose) return;
    void run(async () => {
      const content = { body: body.trim() || 'Pièce jointe', ...(attachment ? { document: await encodedFile(attachment) } : {}) };
      if (view.kind === 'compose') {
        const draft = { childId, subject, ...content };
        if (isTeacher) draft.guardianReference = reference;
        else if (recipient !== 'direction') draft.teacherId = recipient;
        const { id } = await request(collection, { method: 'POST', body: draft });
        setBody('');
        setAttachment(null);
        setSubject('');
        setGuardianReference('');
        setNotice('Message envoyé.');
        setView({ kind: 'thread', id });
        await loadThread(id);
        return;
      }
      try {
        await request(conversationPath(view.id), { method: 'POST', body: content });
      } catch (error) {
        if (error.status !== 404 || !isParent || thread.conversation.channel !== 'teacher') throw error;
        await loadThread(view.id);
        setProblem('L’envoi a échoué. Vérifiez si l’enseignant est toujours joignable.');
        return;
      }
      setBody('');
      setAttachment(null);
      setNotice('Message envoyé.');
      await loadThread(view.id);
    }, { sending: true });
  }

  useEffect(() => {
    if (!initialDraft) void run(() => loadInbox());
  }, []);

  useEffect(() => {
    if (view.kind === 'compose') return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void run(() => view.kind === 'inbox' ? loadInbox() : loadThread(view.id));
      }
    });
    return () => subscription.remove();
  }, [view]);

  useEffect(() => {
    const messageId = thread?.messages[0]?.id;
    if (view.kind !== 'thread' || !messageId || lastMarkedMessage.current === messageId
        || (AppState.currentState && AppState.currentState !== 'active')) return undefined;

    let displayed = true;
    void request(conversationPath(view.id) + '/read', { method: 'PUT', body: { messageId } }).then(() => {
      if (!displayed) return;
      lastMarkedMessage.current = messageId;
      refreshUnread();
    }).catch(() => {
      // Une actualisation du fil retentera la confirmation de lecture.
    });
    return () => { displayed = false; };
  }, [request, refreshUnread, thread, view]);

  const { conversations, nextCursor } = inbox ?? emptyInbox;
  const composing = view.kind === 'compose';
  const messageField = (
    <>
      <Field label={composing ? 'Message' : 'Votre réponse'} value={body} onChangeText={setBody}
        maxLength={4000} multiline editable={!busy} style={[styles.input, ui.messageInput]} />
      <View style={styles.actions}>
        <FileButton label={attachment ? 'Remplacer la pièce jointe' : 'Joindre un document'} busy={busy} onFile={setAttachment} />
        {attachment && <Button label="Retirer la pièce jointe" secondary busy={busy} onPress={() => setAttachment(null)} />}
      </View>
      {attachment && <Text style={styles.body}>{attachment.name}</Text>}
    </>
  );

  return (
    <View style={ui.layout}>
      {view.kind !== 'thread' && <Text accessibilityRole="header" style={styles.title}>
        {composing ? 'Nouveau message' : 'Messagerie'}
      </Text>}
      {view.kind !== 'inbox' && <View style={styles.actions}>
        <Button label="Retour" accessibilityLabel="Retour aux conversations" icon="arrow-back-outline" secondary busy={busy} onPress={goToInbox} />
        {view.kind === 'thread' && <Button label="Actualiser" icon="refresh-outline" secondary busy={busy}
          onPress={() => void run(() => loadThread(view.id))} />}
      </View>}
      {problem ? <Text accessibilityRole="alert" style={styles.error}>{problem}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={ui.notice}>{notice}</Text> : null}
      {busy && !thread && !composing && <Text accessibilityLiveRegion="polite" style={styles.body}>Chargement…</Text>}

      {view.kind === 'inbox' && <>
        <View style={styles.actions}>
          {canStart && <Button label="Nouveau message" icon="create-outline" busy={busy}
            onPress={startConversation} />}
          <Button label="Actualiser" icon="refresh-outline" secondary busy={busy} onPress={() => void run(() => loadInbox())} />
        </View>
        {inbox && !conversations.length && <View style={ui.empty}>
          <Ionicons name="chatbubbles-outline" size={34} color="#225344" accessible={false} aria-hidden />
          <Text style={ui.heading}>Aucune conversation</Text>
          <Text style={styles.body}>{isParent
            ? (canStart ? 'Écrivez à la direction ou à un enseignant de votre enfant.' : 'Aucun enfant n’est rattaché à votre compte.')
            : (isTeacher && !canStart ? 'Vous pourrez écrire aux familles dès qu’une classe vous sera affectée.' : 'Vos échanges avec les familles s’afficheront ici.')}</Text>
        </View>}
        {conversations.map((entry) => (
          <Pressable accessibilityRole="button"
            accessibilityLabel={[entry.subject, entry.studentName, isParent && contactLabel(entry), entry.unread && 'Non lue'].filter(Boolean).join(' · ')}
            key={entry.id} disabled={busy} onPress={() => openThread(entry.id)}
            style={({ pressed }) => [ui.conversation, entry.unread && ui.unread, pressed && ui.pressed]}>
            <View style={ui.summary}>
              <Text style={[ui.heading, ui.text]}>{entry.subject}</Text>
              <Text style={[styles.body, ui.text]}>{entry.studentName}</Text>
              {isParent && <Text style={[ui.date, ui.text]}>{contactLabel(entry)}</Text>}
              {entry.lastMessage && <Text style={[styles.body, ui.text]} numberOfLines={2}>
                {entry.lastMessage.sender === role ? 'Vous · ' : ''}{entry.lastMessage.body.replace(/\s+/g, ' ')}
              </Text>}
              <View style={ui.conversationFooter}>
                {entry.unread && <Text style={ui.unreadLabel}>Non lue</Text>}
                <Text style={ui.date}>{dateLabel.format(new Date(entry.lastMessageAt))}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward-outline" size={19} color="#225344" accessible={false} aria-hidden />
          </Pressable>
        ))}
        {nextCursor && <Button label="Plus de conversations" secondary busy={busy}
          onPress={() => void run(() => loadInbox(nextCursor))} />}
      </>}

      {composing && <>
        {isParent ? <>
          <Text style={styles.label}>Enfant concerné</Text>
          <View style={styles.actions}>
            {children.map(({ id, displayName, className }) => (
              <Button key={id} label={displayName + ' · ' + className} icon={id === childId ? 'checkmark-outline' : 'person-outline'}
                selected={id === childId} secondary={id !== childId} busy={busy} onPress={() => chooseChild(id)} />
            ))}
          </View>
          {childId && <Text style={styles.label}>Destinataire</Text>}
          {childId && busy && teachers === null && <Text style={styles.body}>Chargement des destinataires…</Text>}
          {teachers && <View style={styles.actions}>
            <Button label="Direction" icon={recipient === 'direction' ? 'checkmark-outline' : 'business-outline'}
              selected={recipient === 'direction'} secondary={recipient !== 'direction'} busy={busy} onPress={() => setRecipient('direction')} />
            {teachers.map(({ id, label }) => (
              <Button key={id} label={label} icon={recipient === id ? 'checkmark-outline' : 'school-outline'}
                accessibilityLabel={label + ', enseignant'} selected={recipient === id} secondary={recipient !== id}
                busy={busy} onPress={() => setRecipient(id)} />
            ))}
          </View>}
        </> : <>
          <Text style={styles.label}>Classe</Text>
          <View style={styles.actions}>
            {classes.map(({ id, name }) => (
              <Button key={id} label={name} icon={id === classId ? 'checkmark-outline' : 'school-outline'}
                selected={id === classId} secondary={id !== classId} busy={busy} onPress={() => chooseClass(id)} />
            ))}
          </View>
          {classId && busy && students === null && <Text style={styles.body}>Chargement des élèves…</Text>}
          {students?.length === 0 && <Text style={styles.body}>Aucun élève de cette classe n’a de tuteur actif.</Text>}
          {students?.length > 0 && <>
            <Text style={styles.label}>Élève concerné</Text>
            <View style={styles.actions}>
              {students.map(({ id, displayName }) => (
                <Button key={id} label={displayName} icon={id === childId ? 'checkmark-outline' : 'person-outline'}
                  selected={id === childId} secondary={id !== childId} busy={busy}
                  onPress={() => { setChildId(id); setGuardianReference(''); }} />
              ))}
            </View>
          </>}
          {childId && <>
            <Field label="Référence du tuteur destinataire" value={guardianReference} onChangeText={setGuardianReference}
              autoCapitalize="none" maxLength={36} editable={!busy} />
            <Text style={styles.body}>Le tuteur peut vous transmettre sa référence depuis « Compte ».</Text>
          </>}
        </>}
        <Field label="Objet" value={subject} onChangeText={setSubject} maxLength={120} editable={!busy} />
        {messageField}
        <Button label="Envoyer" icon="send-outline" onPress={send} busy={busy || !readyToCompose} />
      </>}

      {view.kind === 'thread' && thread && <>
        <View style={ui.layout}>
          <Text accessibilityRole="header" style={[styles.title, ui.text]}>{thread.conversation.subject}</Text>
          <Text style={[styles.body, ui.text]}>{thread.conversation.studentName}</Text>
          {isParent && <Text style={[ui.date, ui.text]}>{contactLabel(thread.conversation)}</Text>}
          {!isParent && <Text selectable style={ui.date}>Référence tuteur · {thread.conversation.guardianReference}</Text>}
        </View>
        {thread.nextCursor && <Button label="Afficher les anciens messages" icon="time-outline" secondary busy={busy}
          onPress={() => void run(() => loadThread(view.id, thread.nextCursor))} />}
        {[...thread.messages].reverse().map((entry) => {
          const own = entry.sender === role;
          return (
            <View key={entry.id} style={[ui.bubble, own && ui.ownBubble]}>
              <Text style={styles.label}>{own ? 'Vous' : (isParent ? contactLabel(thread.conversation) : 'Tuteur')}</Text>
              <Text selectable style={[styles.body, ui.text]}>{entry.body}</Text>
              {entry.hasDocument && typeof document !== 'undefined' && <Button label="Télécharger la pièce jointe"
                icon="download-outline" secondary busy={busy} onPress={() => void run(async () => {
                  const url = conversationPath(view.id) + '/' + entry.id + '/document';
                  downloadDocument(await request(url, { responseType: 'attachment' }), 'message-' + entry.id);
                })} />}
              <Text style={ui.date}>{dateLabel.format(new Date(entry.sentAt))}</Text>
            </View>
          );
        })}
        {thread.conversation.canReply ? <>
          {messageField}
          <Button label="Envoyer la réponse" icon="send-outline" busy={busy || (!body.trim() && !attachment)} onPress={send} />
        </> : <Text style={styles.body}>Cet enseignant n’est plus joignable pour cet élève. L’historique reste consultable.</Text>}
      </>}
    </View>
  );
}

const ui = StyleSheet.create({
  layout: { gap: 14, minWidth: 0 },
  heading: { color: '#17372d', fontSize: 19, fontWeight: '700' },
  empty: { padding: 20, gap: 8, borderRadius: 14, backgroundColor: '#f0f4eb' },
  conversation: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: 14, backgroundColor: '#f7f8f1', borderWidth: 1, borderColor: '#dbe3d5', borderRadius: 12,
  },
  summary: { flex: 1, minWidth: 0, gap: 3 },
  conversationFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 3 },
  unread: { backgroundColor: '#eaf3e7', borderColor: '#78977e' },
  unreadLabel: { color: '#17372d', backgroundColor: '#d7e9d7', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2, fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.72 },
  messageInput: { minHeight: 96, textAlignVertical: 'top' },
  notice: { color: '#225344', fontSize: 15, fontWeight: '700' },
  bubble: { alignSelf: 'flex-start', maxWidth: '94%', padding: 14, gap: 5, backgroundColor: '#f1f0e8', borderRadius: 13 },
  ownBubble: { alignSelf: 'flex-end', backgroundColor: '#e5efe5' },
  text: { flexShrink: 1, ...Platform.select({ web: { overflowWrap: 'anywhere' } }) },
  date: { color: '#43584c', fontSize: 13 },
});
