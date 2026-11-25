import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Field, styles } from '../parent/ui';

const collection = '/conversations';
const emptyInbox = { conversations: [], nextCursor: null };
const inboxView = { kind: 'inbox' };
const dateLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

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
    case 404: return 'Cette conversation ou ce lien avec l’élève n’est plus accessible.';
    default: return 'L’opération a échoué. Réessayez dans un instant.';
  }
}

export function Messages({ request, children, onExpired }) {
  const isParent = children !== undefined;
  const [view, setView] = useState(inboxView);
  const [inbox, setInbox] = useState(null);
  const [thread, setThread] = useState(null);
  const [childId, setChildId] = useState(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const inProgress = useRef(false);

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
    void run(() => loadThread(id));
  }

  function goToInbox() {
    setView(inboxView);
    setThread(null);
    setSubject('');
    setBody('');
    void run(() => loadInbox());
  }

  function startConversation() {
    setChildId(children.length === 1 ? children[0].id : null);
    setSubject('');
    setBody('');
    setNotice('');
    setProblem('');
    setView({ kind: 'compose' });
  }

  function send() {
    if (!body.trim()) return;
    if (view.kind === 'compose' && (!childId || !subject.trim())) return;
    void run(async () => {
      if (view.kind === 'compose') {
        const { id } = await request(collection, { method: 'POST', body: { childId, subject, body } });
        setBody('');
        setSubject('');
        setNotice('Message envoyé.');
        setView({ kind: 'thread', id });
        await loadThread(id);
        return;
      }
      await request(conversationPath(view.id), { method: 'POST', body: { body } });
      setBody('');
      setNotice('Message envoyé.');
      await loadThread(view.id);
    }, { sending: true });
  }

  useEffect(() => {
    void run(() => loadInbox());
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

  const { conversations, nextCursor } = inbox ?? emptyInbox;
  const composing = view.kind === 'compose';
  const messageField = (
    <Field label={composing ? 'Message' : 'Votre réponse'} value={body} onChangeText={setBody}
      maxLength={4000} multiline editable={!busy} style={[styles.input, ui.messageInput]} />
  );

  return (
    <View style={ui.layout}>
      {view.kind !== 'thread' && <Text accessibilityRole="header" style={styles.title}>
        {composing ? 'Écrire à la direction' : 'Messagerie'}
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
          {isParent && children.length > 0 && <Button label="Nouveau message" icon="create-outline" busy={busy}
            onPress={startConversation} />}
          <Button label="Actualiser" icon="refresh-outline" secondary busy={busy} onPress={() => void run(() => loadInbox())} />
        </View>
        {inbox && !conversations.length && <View style={ui.empty}>
          <Ionicons name="chatbubbles-outline" size={34} color="#225344" accessible={false} aria-hidden />
          <Text style={ui.heading}>Aucune conversation</Text>
          <Text style={styles.body}>{isParent
            ? (children.length ? 'Écrivez à la direction au sujet de l’un de vos enfants.' : 'Aucun enfant n’est rattaché à votre compte.')
            : 'Les messages envoyés par les familles s’afficheront ici.'}</Text>
        </View>}
        {conversations.map((entry) => (
          <Pressable accessibilityRole="button" accessibilityLabel={entry.subject + ' · ' + entry.studentName}
            key={entry.id} disabled={busy} onPress={() => openThread(entry.id)}
            style={({ pressed }) => [ui.conversation, pressed && ui.pressed]}>
            <View style={ui.summary}>
              <Text style={[ui.heading, ui.text]}>{entry.subject}</Text>
              <Text style={[styles.body, ui.text]}>{entry.studentName}</Text>
              <Text style={ui.date}>{dateLabel.format(new Date(entry.lastMessageAt))}</Text>
            </View>
            <Ionicons name="chevron-forward-outline" size={19} color="#225344" accessible={false} aria-hidden />
          </Pressable>
        ))}
        {nextCursor && <Button label="Plus de conversations" secondary busy={busy}
          onPress={() => void run(() => loadInbox(nextCursor))} />}
      </>}

      {composing && <>
        <Text style={styles.label}>Enfant concerné</Text>
        <View style={styles.actions}>
          {children.map(({ id, displayName, className }) => (
            <Button key={id} label={displayName + ' · ' + className} icon={id === childId ? 'checkmark-outline' : 'person-outline'}
              secondary={id !== childId} busy={busy} onPress={() => setChildId(id)} />
          ))}
        </View>
        <Field label="Objet" value={subject} onChangeText={setSubject} maxLength={120} editable={!busy} />
        {messageField}
        <Button label="Envoyer" icon="send-outline" onPress={send}
          busy={busy || !childId || !subject.trim() || !body.trim()} />
      </>}

      {view.kind === 'thread' && thread && <>
        <View style={ui.layout}>
          <Text accessibilityRole="header" style={[styles.title, ui.text]}>{thread.conversation.subject}</Text>
          <Text style={[styles.body, ui.text]}>{thread.conversation.studentName}</Text>
          {!isParent && <Text selectable style={ui.date}>Référence tuteur · {thread.conversation.guardianReference}</Text>}
        </View>
        {thread.nextCursor && <Button label="Afficher les anciens messages" icon="time-outline" secondary busy={busy}
          onPress={() => void run(() => loadThread(view.id, thread.nextCursor))} />}
        {[...thread.messages].reverse().map((entry) => {
          const own = entry.sender === (isParent ? 'parent' : 'direction');
          return (
            <View key={entry.id} style={[ui.bubble, own && ui.ownBubble]}>
              <Text style={styles.label}>{own ? 'Vous' : (isParent ? 'Direction' : 'Tuteur')}</Text>
              <Text selectable style={[styles.body, ui.text]}>{entry.body}</Text>
              <Text style={ui.date}>{dateLabel.format(new Date(entry.sentAt))}</Text>
            </View>
          );
        })}
        {messageField}
        <Button label="Envoyer la réponse" icon="send-outline" busy={busy || !body.trim()} onPress={send} />
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
  pressed: { opacity: 0.72 },
  messageInput: { minHeight: 96, textAlignVertical: 'top' },
  notice: { color: '#225344', fontSize: 15, fontWeight: '700' },
  bubble: { alignSelf: 'flex-start', maxWidth: '94%', padding: 14, gap: 5, backgroundColor: '#f1f0e8', borderRadius: 13 },
  ownBubble: { alignSelf: 'flex-end', backgroundColor: '#e5efe5' },
  text: { flexShrink: 1, ...Platform.select({ web: { overflowWrap: 'anywhere' } }) },
  date: { color: '#43584c', fontSize: 13 },
});
