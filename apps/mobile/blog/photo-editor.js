import React, { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { photoPath } from './gallery';
import { PhotoImage } from './photo-image';

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

function DraftPhoto({ photo, index, articlePath, request, onChange, onOpen, busy }) {
  const [panel, setPanel] = useState(null);
  const [description, setDescription] = useState(photo.description);
  const label = photo.description || `Photo ${index + 1}`;
  function apply(action, options) {
    onChange(photo.id, action, options, () => setPanel(null));
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
          <Text style={styles.body}>{photo.reviewed ? 'Vérifiée' : 'À vérifier avant publication'}</Text>
          {photo.description ? <Text style={styles.body} numberOfLines={2}>{photo.description}</Text> : null}
        </View>
      </View>
      {panel === 'review' ? <>
        <Field label="Description de la photo" value={description} onChangeText={setDescription} maxLength={180} editable={!busy} />
        <Text style={styles.body}>Validez la photo après avoir vérifié les autorisations des personnes identifiables.</Text>
        <View style={styles.actions}>
          <Button label="Valider la photo" icon="checkmark-outline" busy={busy}
            onPress={() => apply('', { method: 'PUT', body: { description, reviewed: true } })} />
          {photo.reviewed && <Button label="Retirer la validation" busy={busy} secondary
            onPress={() => apply('', { method: 'PUT', body: { description, reviewed: false } })} />}
          <Button label="Annuler" busy={busy} secondary onPress={() => setPanel(null)} />
        </View>
      </> : panel === 'remove' ? <>
        <Text style={styles.body}>Supprimer cette photo du brouillon ?</Text>
        <View style={styles.actions}>
          <Button label="Confirmer la suppression de la photo" busy={busy} onPress={() => apply('', { method: 'DELETE' })} />
          <Button label="Annuler" busy={busy} secondary onPress={() => setPanel(null)} />
        </View>
      </> : <View style={styles.actions}>
        <Button label={photo.reviewed ? 'Modifier la description' : 'Vérifier la photo'} busy={busy} secondary
          onPress={() => { setDescription(photo.description); setPanel('review'); }} />
        {index > 0 && <Button label="Mettre en couverture" busy={busy} secondary
          onPress={() => apply('/cover', { method: 'PUT' })} />}
        <Button label="Supprimer la photo" icon="trash-outline" busy={busy} secondary onPress={() => setPanel('remove')} />
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
