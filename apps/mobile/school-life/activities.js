import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { layout } from '../year-transition/ui';
import { downloadDocument, encodedFile, FileButton } from '../files/documents';
import { activityLabels, Problem, schoolDateTime, schoolInstant, schoolTimeLabel, useSchoolTask } from './ui';

const path = '/activities';
const answers = { yes: 'Participe', no: 'Ne participe pas', booked: 'Réservé', read: 'Lecture confirmée' };
const bodyStyle = [styles.input, { minHeight: 100, textAlignVertical: 'top' }];

function blank(classes, teacher) {
  return {
    kind: 'announcement', classIds: teacher && classes.length === 1 ? [classes[0].id] : [],
    title: '', body: '', needsReceipt: false, starts: '', ends: '', publication: '', hasDocument: false,
  };
}

export function StaffActivities({ classes, teacher, request, onExpired }) {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [details, setDetails] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [notice, setNotice] = useState('');
  const { busy, problem, run } = useSchoolTask(onExpired);

  async function load() {
    setItems((await request(path)).activities);
  }

  useEffect(() => { void run(load); }, []);

  function edit(item) {
    setPreview(null);
    setDetails(null);
    setNotice('');
    setDraft(item ? {
      ...item, starts: schoolDateTime(item.startsAt), ends: schoolDateTime(item.endsAt), publication: schoolDateTime(item.publishAt),
    } : blank(classes, teacher));
  }

  function change(patch) {
    setDraft((before) => ({ ...before, ...patch }));
    setPreview(null);
  }

  const timed = draft?.kind === 'invitation' || draft?.kind === 'slot';
  const hasAudience = draft && (!teacher || draft.classIds.length) && (draft.kind !== 'slot' || draft.classIds.length === 1);
  const startsAt = timed ? schoolInstant(draft.starts) : null;
  const endsAt = timed ? schoolInstant(draft.ends) : null;
  const publication = draft?.publication ? schoolInstant(draft.publication) : 'now';
  const ready = hasAudience && draft.title.trim() && (timed ? startsAt && endsAt && startsAt < endsAt : draft.body.trim());

  function save(publishAt) {
    void run(async () => {
      const { id, kind, classIds, title, body, needsReceipt } = draft;
      await request(path + (id ? '/' + id : ''), {
        method: id ? 'PUT' : 'POST',
        body: { kind, classIds, title, body, needsReceipt: !timed && needsReceipt, publishAt, startsAt, endsAt },
      });
      setDraft(null);
      setPreview(null);
      setNotice(publishAt === null ? 'Brouillon enregistré.' : publishAt === 'now' ? 'Publication en ligne.' : 'Publication programmée.');
      await load();
    });
  }

  return <View style={layout.group}>
    <Text accessibilityRole="header" style={styles.title}>Annonces et rendez-vous</Text>
    <Problem value={problem} />
    {notice && <Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text>}
    {draft ? <>
      <View style={styles.actions}>{Object.entries(activityLabels).map(([kind, label]) =>
        <Button key={kind} label={label} secondary={kind !== draft.kind} selected={kind === draft.kind} busy={busy}
          onPress={() => change({ kind, classIds: kind === 'slot' ? draft.classIds.slice(0, 1) : draft.classIds })} />)}</View>
      <Field label="Titre" value={draft.title} onChangeText={(title) => change({ title })} editable={!busy} maxLength={120} />
      <Field label="Message" value={draft.body} onChangeText={(body) => change({ body })} editable={!busy}
        multiline style={bodyStyle} maxLength={2500} />
      <Text style={styles.label}>Destinataires</Text>
      <View style={styles.actions}>
        {!teacher && draft.kind !== 'slot' && <Button label="Toute l’école" secondary={draft.classIds.length > 0}
          busy={busy} onPress={() => change({ classIds: [] })} />}
        {classes.map(({ id, name }) => <Button key={id} label={name} busy={busy} secondary={!draft.classIds.includes(id)}
          onPress={() => change({ classIds: draft.kind === 'slot' ? [id] : draft.classIds.includes(id)
            ? draft.classIds.filter((value) => value !== id) : [...draft.classIds, id] })} />)}
      </View>
      {timed ? <>
        <Field label="Début · heure de Paris" placeholder="AAAA-MM-JJ HH:MM" value={draft.starts}
          editable={!busy} maxLength={16} onChangeText={(starts) => change({ starts })} />
        <Field label="Fin · heure de Paris" placeholder="AAAA-MM-JJ HH:MM" value={draft.ends}
          editable={!busy} maxLength={16} onChangeText={(ends) => change({ ends })} />
      </> : <Button label={draft.needsReceipt ? 'Accusé de lecture demandé' : 'Demander un accusé de lecture'}
        secondary={!draft.needsReceipt} selected={draft.needsReceipt} busy={busy}
        onPress={() => change({ needsReceipt: !draft.needsReceipt })} />}
      <Field label="Programmer la publication · heure de Paris" placeholder="AAAA-MM-JJ HH:MM · facultatif" value={draft.publication}
        editable={!busy} maxLength={16} onChangeText={(value) => change({ publication: value })} />
      {draft.id && draft.kind !== 'slot' && <FileButton label={draft.hasDocument ? 'Remplacer le document' : 'Joindre un document'}
        busy={busy} onFile={(file) => void run(async () => {
          await request(path + '/' + draft.id + '/document', { method: 'PUT', body: { content: await encodedFile(file) } });
          change({ hasDocument: true });
          await load();
        })} />}
      {preview && <View style={layout.card}>
        <Text accessibilityRole="header" style={layout.heading}>Aperçu avant publication</Text>
        <Text style={styles.label}>{draft.title}</Text>
        {draft.body ? <Text style={styles.body}>{draft.body}</Text> : null}
        <Text style={layout.status}>{draft.classIds.length ? preview.classes.map(({ name }) => name).join(' · ') : 'Toute l’école'}</Text>
        <Text style={layout.status}>{preview.guardians} compte(s) parent · {preview.students} élève(s)</Text>
        {timed && <Text style={layout.status}>{schoolTimeLabel(startsAt)} · {schoolTimeLabel(endsAt)}</Text>}
        {draft.hasDocument && <Text style={layout.status}>Document joint</Text>}
      </View>}
      <View style={styles.actions}>
        <Button label={preview ? (publication === 'now' ? 'Publier' : 'Programmer') : 'Vérifier les destinataires'}
          busy={busy || !ready || !publication} onPress={() => {
            if (preview) save(publication);
            else void run(async () => setPreview(await request(path + '/audience', { method: 'POST', body: { classIds: draft.classIds } })));
          }} />
        <Button label="Enregistrer le brouillon" secondary busy={busy || !ready} onPress={() => save(null)} />
        <Button label="Retour aux publications" secondary busy={busy} onPress={() => setDraft(null)} />
      </View>
    </> : <>
      <View style={styles.actions}>
        <Button label="Créer une publication" icon="add-outline" busy={busy} onPress={() => edit(null)} />
        <Button label="Actualiser les publications" secondary busy={busy} onPress={() => void run(load)} />
      </View>
      {!busy && !items.length && <Text style={styles.body}>Aucune publication.</Text>}
      {items.map((item) => <View key={item.id} style={layout.card}>
        <Text style={layout.status}>{activityLabels[item.kind]} · {item.live ? 'En ligne' : item.publishAt ? 'Programmé' : 'Brouillon'}</Text>
        <Text style={styles.label}>{item.title}</Text>
        {item.startsAt && <Text style={layout.status}>{schoolTimeLabel(item.startsAt)}</Text>}
        <View style={styles.actions}>
          {!item.live && <Button label="Modifier" accessibilityLabel={'Modifier ' + item.title}
            secondary busy={busy} onPress={() => edit(item)} />}
          {item.live && (item.needsReceipt || item.kind !== 'announcement') && <Button
            label="Voir les réponses" accessibilityLabel={'Voir les réponses à ' + item.title} secondary busy={busy}
            onPress={() => void run(async () => setDetails({ id: item.id, ...(await request(path + '/' + item.id + '/responses')) }))} />}
          <Button label={removing === item.id ? 'Confirmer le retrait' : 'Retirer'}
            accessibilityLabel={(removing === item.id ? 'Confirmer le retrait de ' : 'Retirer ') + item.title}
            secondary busy={busy} onPress={() => {
              if (removing !== item.id) return setRemoving(item.id);
              void run(async () => {
                await request(path + '/' + item.id, { method: 'DELETE' });
                setRemoving(null);
                setDetails(null);
                await load();
              });
            }} />
          {removing === item.id && <Button label="Annuler" secondary onPress={() => setRemoving(null)} />}
        </View>
        {details?.id === item.id && <>
          {!details.responses.length && <Text style={layout.status}>Aucune réponse.</Text>}
          {details.responses.map((entry) => <Text key={entry.guardianId + '/' + (entry.studentId ?? '')} style={styles.body}>
            {entry.studentName ? entry.studentName + ' · ' : ''}{entry.guardianName || 'Responsable ' + entry.guardianId.slice(-6)} · {answers[entry.answer]}
          </Text>)}
        </>}
      </View>)}
    </>}
  </View>;
}

export function FamilyActivities({ request, initialId, onBack, onExpired }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(initialId ?? null);
  const { busy, problem, run } = useSchoolTask(onExpired);

  async function load(focus) {
    const { activities } = await request(path);
    if (focus && !activities.some(({ id }) => id === focus)) {
      try {
        activities.unshift(await request(path + '/' + focus));
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    setItems(activities);
  }

  useEffect(() => { void run(() => load(initialId)); }, [initialId]);

  function respond(item, childId, answer) {
    void run(async () => {
      await request(path + '/' + item.id + '/response', { method: 'PUT', body: { childId, answer } });
      await load(item.id);
    });
  }

  return <View style={styles.panel}>
    <Button label="Retour à l’accueil" icon="arrow-back-outline" secondary onPress={onBack} />
    <Text accessibilityRole="header" style={styles.title}>Annonces et invitations</Text>
    <Problem value={problem} />
    {!busy && !items.length && <Text style={styles.body}>Aucune annonce ou invitation disponible.</Text>}
    {items.map((item) => <View key={item.id} style={layout.card}>
      <Text style={layout.status}>{activityLabels[item.kind]} · {schoolTimeLabel(item.startsAt ?? item.publishAt)}</Text>
      <Button label={item.title} expanded={open === item.id} icon={open === item.id ? 'chevron-up-outline' : 'chevron-down-outline'}
        secondary onPress={() => setOpen(open === item.id ? null : item.id)} />
      {open === item.id && <>
        {!!item.body && <Text selectable style={styles.body}>{item.body}</Text>}
        {item.hasDocument && <Button label="Ouvrir le document" icon="document-outline" secondary busy={busy}
          onPress={() => void run(async () => downloadDocument(await request(path + '/' + item.id + '/document',
            { responseType: 'attachment' }), 'document-ecole'))} />}
        {item.needsReceipt && (item.acknowledged
          ? <Text style={styles.label}>Lecture confirmée</Text>
          : <Button label="Confirmer la lecture" busy={busy} onPress={() => respond(item, null, 'read')} />)}
        {item.kind !== 'announcement' && item.children.map((child) => <View key={child.id} style={layout.group}>
          <Text style={styles.label}>{child.displayName}{child.answer ? ' · ' + answers[child.answer] : ''}</Text>
          {new Date(item.startsAt) > new Date() && <View style={styles.actions}>
            {item.kind === 'invitation' ? <>
              <Button label="Participera" selected={child.answer === 'yes'} secondary={child.answer !== 'yes'} busy={busy}
                onPress={() => respond(item, child.id, 'yes')} />
              <Button label="Ne participera pas" selected={child.answer === 'no'} secondary={child.answer !== 'no'} busy={busy}
                onPress={() => respond(item, child.id, 'no')} />
            </> : child.answer === 'booked'
              ? <Button label="Annuler la réservation" secondary busy={busy} onPress={() => respond(item, child.id, 'withdraw')} />
              : !item.children.some(({ answer }) => answer === 'booked') && <Button label="Réserver ce créneau" busy={busy}
                onPress={() => respond(item, child.id, 'booked')} />}
          </View>}
        </View>)}
      </>}
    </View>)}
  </View>;
}
