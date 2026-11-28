import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { encodedFile, FileButton } from '../files/documents';
import { RequestError } from '../parent/http';
import { layout } from '../year-transition/ui';
import { Problem, schoolTimeLabel, useSchoolTask } from './ui';

const path = '/directory';
const sample = 'type;reference;nom;classe;eleves\nclasse;ce1;CE1 fictif;;\neleve;e1;Élève fictif;ce1;\nresponsable;r1;Responsable fictif;;e1';
const labels = { classe: 'Classe', eleve: 'Élève', responsable: 'Responsable' };
const actions = {
  created: 'Accès créé', linked: 'Enfant rattaché', unlinked: 'Enfant retiré', suspended: 'Accès suspendu',
  reactivated: 'Accès réactivé', invited: 'Invitation créée', 'sessions-replaced': 'Invitation créée et sessions fermées',
};
const statuses = {
  suspended: 'Suspendue', revoked: 'Révoquée', used: 'Utilisée', expired: 'Expirée', pending: 'En attente', none: 'À inviter',
};

export function DirectoryImport({ request, onImported, onExpired }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState(null);
  const [acceptHomonyms, setAccept] = useState(false);
  const [result, setResult] = useState(null);
  const { busy, problem, run } = useSchoolTask(onExpired);

  function load(value) {
    setCsv(value);
    setPreview(null);
    setAccept(false);
    setResult(null);
  }

  return <View style={layout.group}>
    <Text accessibilityRole="header" style={styles.title}>Importer les listes</Text>
    <Text style={styles.body}>Choisissez ou collez un CSV à séparateur point-virgule. Chaque responsable peut référencer plusieurs élèves en séparant leurs références par |.</Text>
    <View style={styles.actions}>
      <FileButton label="Choisir un CSV" accept=".csv,text/csv,text/plain,application/vnd.ms-excel" limit={128 * 1024}
        busy={busy} onFile={(file) => void run(async () => {
          const content = await encodedFile(file, 128 * 1024);
          const bytes = Uint8Array.from(atob(content), (character) => character.charCodeAt(0));
          try { load(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
          catch { throw new RequestError(400); }
        })} />
      <Button label="Insérer un exemple fictif" secondary busy={busy} onPress={() => load(sample)} />
    </View>
    <Field label="Contenu du CSV" value={csv} onChangeText={load} multiline maxLength={128 * 1024}
      editable={!busy} style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]} />
    <Problem value={problem} />
    {result && <Text accessibilityLiveRegion="polite" style={styles.label}>
      Import terminé · {result.classes} classe(s), {result.students} élève(s), {result.guardians} responsable(s)
    </Text>}
    <View style={styles.actions}><Button label="Prévisualiser l’import" secondary={!!preview} busy={busy || !csv.trim()}
      onPress={() => void run(async () => setPreview(await request(path + '/import/preview', { method: 'POST', body: { csv } })))} /></View>
    {preview && <View style={layout.group}>
      <Text accessibilityRole="header" style={layout.heading}>Fiches et rattachements à créer</Text>
      {preview.errors.map((message, index) => <Text key={index} style={styles.error}>{message}</Text>)}
      {preview.warnings.map((message, index) => <Text key={index} style={styles.body}>{message}</Text>)}
      {preview.items.map((row, index) => <View key={index} style={layout.card}>
        <Text style={styles.label}>{labels[row.kind]} · {row.name}</Text>
        {row.room && <Text style={layout.status}>{row.room}</Text>}
        {!!row.children.length && <Text style={layout.status}>{row.children.filter(Boolean).join(' · ')}</Text>}
      </View>)}
      {!!preview.warnings.length && <Button label="Confirmer la création de fiches distinctes pour les homonymes"
        selected={acceptHomonyms} secondary={!acceptHomonyms} busy={busy} onPress={() => setAccept(!acceptHomonyms)} />}
      <Button label="Valider les fiches et les rattachements" busy={busy || !!preview.errors.length
        || (!!preview.warnings.length && !acceptHomonyms)} onPress={() => void run(async () => {
        const created = await request(path + '/import', { method: 'POST', body: { csv, tag: preview.tag, acceptHomonyms } });
        load('');
        setResult(created);
        await onImported();
      })} />
    </View>}
  </View>;
}

export function DirectoryTracking({ request, section, onExpired }) {
  const [rows, setRows] = useState([]);
  const { busy, problem, run } = useSchoolTask(onExpired);
  const audit = section === 'audit';

  function load() {
    void run(async () => {
      const response = await request(path + (audit ? '/access-log' : '/invitation-status'));
      setRows(audit ? response.entries : response.invitations);
    });
  }
  useEffect(load, []);
  return <View style={layout.group}>
    <Text accessibilityRole="header" style={styles.title}>{audit ? 'Journal des accès parents' : 'Suivi des invitations'}</Text>
    <Problem value={problem} />
    <Button label="Actualiser le suivi" secondary busy={busy} onPress={load} />
    {!busy && !rows.length && <Text style={styles.body}>Aucune entrée à afficher.</Text>}
    {rows.map((row) => <View key={row.id} style={layout.card}>
      <Text style={styles.label}>{audit ? actions[row.action] : (row.displayName || 'Responsable ' + row.id.slice(-6))}</Text>
      {audit ? <>
        <Text style={styles.body}>{[row.guardianName || 'Responsable', row.studentName].filter(Boolean).join(' · ')}</Text>
        <Text style={layout.status}>{schoolTimeLabel(row.occurredAt)} · Direction</Text>
      </> : <Text style={layout.status}>{statuses[row.status]}{row.status === 'pending' && row.expiresAt
        ? ' · jusqu’au ' + schoolTimeLabel(row.expiresAt) : ''}</Text>}
    </View>)}
  </View>;
}
