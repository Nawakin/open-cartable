import React, { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { authorizationLabel } from '../photo-authorizations/ui';
import { photoPath } from './gallery';
import { PhotoImage } from './photo-image';
import { PhotoMasks } from './photo-masks';

export function PhotoPicker({ onPick, busy }) {
  const input = useRef(null);
  if (Platform.OS !== 'web') return null;
  return <View>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple
      hidden disabled={busy} onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length) onPick(files);
      }} />
    <Button label="Ajouter des photos" icon="images-outline" onPress={() => input.current?.click()} busy={busy} secondary />
  </View>;
}

function DraftPhoto({ photo, index, articlePath, request, onChange, onOpen, busy, students, onLoadAuthorizations }) {
  const [panel, setPanel] = useState(null);
  const [description, setDescription] = useState(photo.description);
  const [mode, setMode] = useState(null);
  const [studentIds, setStudentIds] = useState([]);
  const [search, setSearch] = useState('');
  const allowed = studentIds.every((id) => students?.some((student) => student.id === id && student.status === 'allowed'));
  const canValidate = mode === 'none' || (mode === 'students' && studentIds.length > 0 && allowed);
  const term = search.trim().toLocaleLowerCase('fr-FR');
  const matching = students?.filter(({ displayName }) => displayName.toLocaleLowerCase('fr-FR').includes(term));
  const missingStudent = students && studentIds.some((id) => !students.some((student) => student.id === id));
  const label = photo.description || `Photo ${index + 1}`;
  function apply(action, options) {
    onChange(photo.id, action, options, () => setPanel(null));
  }

  function startReview() {
    setDescription(photo.description);
    setMode(['none', 'students'].includes(photo.reviewBasis) ? photo.reviewBasis : null);
    setStudentIds(photo.studentIds ?? []);
    setSearch('');
    setPanel('review');
    onLoadAuthorizations();
  }

  return (
    <View style={editor.card}>
      <View style={editor.summary}>
        <Pressable accessibilityRole="button" accessibilityLabel={'Agrandir · ' + label}
          disabled={busy} onPress={() => onOpen(index)} style={editor.thumbnail}>
          <PhotoImage role="teacher" request={request} path={photoPath(articlePath, photo.id, 'thumb')} label={label} />
        </Pressable>
        <View style={editor.details}>
          <Text style={styles.label}>{index === 0 ? 'Photo de couverture' : `Photo ${index + 1}`}</Text>
          <Text style={styles.body}>{photo.publishable ? 'Vérifiée' : (photo.reviewed ? 'À revérifier' : 'À vérifier avant publication')}</Text>
          {photo.description ? <Text style={styles.body} numberOfLines={2}>{photo.description}</Text> : null}
        </View>
      </View>
      {panel === 'mask' ? <PhotoMasks path={photoPath(articlePath, photo.id, 'full')} label={label} busy={busy}
        onApply={(masks) => apply('/masks', { method: 'PUT', body: { masks } })}
        onClose={() => setPanel('options')} /> : panel === 'review' ? <>
        <Field label="Description de la photo" value={description} onChangeText={setDescription} maxLength={180} editable={!busy} />
        <Text style={styles.label}>Élèves reconnaissables sur cette photo</Text>
        <View style={styles.actions}>
          <Button label="Aucun élève reconnaissable" selected={mode === 'none'} secondary={mode !== 'none'} busy={busy}
            onPress={() => { setMode('none'); setStudentIds([]); }} />
          <Button label="Des élèves sont reconnaissables" selected={mode === 'students'} secondary={mode !== 'students'} busy={busy}
            onPress={() => setMode('students')} />
        </View>
        {mode === 'students' && <>
          <Text style={styles.body}>Sélectionnez tous les élèves reconnaissables.</Text>
          {(!students || !allowed) && <View style={styles.actions}>
            <Button label="Actualiser les autorisations" busy={busy} secondary onPress={onLoadAuthorizations} />
          </View>}
          {students?.length > 5 && <Field label="Rechercher dans la classe" value={search} onChangeText={setSearch} maxLength={100} />}
          {matching?.length === 0 && <Text style={styles.body}>Aucun élève dans cette liste.</Text>}
          <View style={styles.actions}>
            {matching?.map(({ id, displayName, status }) => {
              const selected = studentIds.includes(id);
              return <Button key={id} label={`${displayName} · ${authorizationLabel(status)}`}
                icon={selected ? 'checkmark-outline' : 'person-outline'} selected={selected} secondary={!selected} busy={busy}
                onPress={() => setStudentIds((before) => selected ? before.filter((entry) => entry !== id) : [...before, id])} />;
            })}
          </View>
          {missingStudent && <Button label="Réinitialiser la sélection" busy={busy} secondary onPress={() => setStudentIds([])} />}
          {studentIds.length > 0 && !allowed && <>
            <Text accessibilityRole="alert" style={styles.error}>Une autorisation valable manque.</Text>
            {Platform.OS === 'web' && <View style={styles.actions}>
              <Button label="Masquer une zone" icon="scan-outline" busy={busy} secondary onPress={() => setPanel('mask')} />
            </View>}
          </>}
        </>}
        <View style={styles.actions}>
          <Button label="Valider la photo" icon="checkmark-outline" busy={busy || !canValidate}
            onPress={() => apply('', { method: 'PUT', body: { description, reviewed: true, studentIds } })} />
          {photo.reviewed && <Button label="Retirer la validation" busy={busy} secondary
            onPress={() => apply('', { method: 'PUT', body: { description, reviewed: false, studentIds: [] } })} />}
          <Button label="Annuler" busy={busy} secondary onPress={() => setPanel(null)} />
        </View>
      </> : panel === 'remove' ? <>
        <Text style={styles.body}>Supprimer cette photo du brouillon ?</Text>
        <View style={styles.actions}>
          <Button label="Confirmer la suppression de la photo" busy={busy} onPress={() => apply('', { method: 'DELETE' })} />
          <Button label="Annuler" busy={busy} secondary onPress={() => setPanel(null)} />
        </View>
      </> : panel === 'options' ? <View style={styles.actions}>
        {Platform.OS === 'web' && <Button label="Masquer une zone" icon="scan-outline" busy={busy} secondary onPress={() => setPanel('mask')} />}
        {index > 0 && <Button label="Mettre en couverture" icon="image-outline" busy={busy} secondary
          onPress={() => apply('/cover', { method: 'PUT' })} />}
        <Button label="Supprimer la photo" icon="trash-outline" busy={busy} secondary onPress={() => setPanel('remove')} />
        <Button label="Fermer les options" busy={busy} secondary onPress={() => setPanel(null)} />
      </View> : <View style={styles.actions}>
        <Button label={photo.publishable ? 'Modifier la vérification' : 'Vérifier la photo'} busy={busy} secondary onPress={startReview} />
        <Button label="Options" accessibilityLabel={'Options · ' + label} icon="ellipsis-horizontal-outline"
          busy={busy} secondary onPress={() => setPanel('options')} />
      </View>}
    </View>
  );
}

export function DraftGallery({ photos, ...props }) {
  return photos.map((photo, index) => <DraftPhoto key={photo.id} photo={photo} index={index} {...props} />);
}

const editor = StyleSheet.create({
  card: { backgroundColor: '#f0f4eb', borderRadius: 13, padding: 13, gap: 10 },
  summary: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumbnail: { width: 100, height: 74, borderRadius: 8, overflow: 'hidden', backgroundColor: '#dce7d9' },
  details: { flex: 1, minWidth: 0, gap: 3 },
});
