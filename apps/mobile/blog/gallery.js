import React, { useEffect, useRef } from 'react';
import { Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PhotoImage } from './photo-image';

export function photoPath(articlePath, photoId, size) {
  return articlePath + '/photos/' + encodeURIComponent(photoId) + '?size=' + size;
}

function photoLabel(photo, index) {
  return photo.description || `Photo ${index + 1}`;
}

export function GalleryPreview({ article, articlePath, request, role, onOpen, busy }) {
  const [first, second] = article.photos ?? [];
  const remaining = (article.photoCount ?? 0) - 1;
  if (!first) return null;

  return (
    <View style={gallery.preview}>
      <Pressable accessibilityRole="button" accessibilityLabel={'Voir la photo de couverture · ' + photoLabel(first, 0)}
        disabled={busy} onPress={() => onOpen(0)}
        style={({ pressed }) => [gallery.tile, gallery.cover, pressed && gallery.pressed]}>
        <PhotoImage role={role} request={request} path={photoPath(articlePath, first.id, 'thumb')} label={photoLabel(first, 0)} />
      </Pressable>
      {second && <Pressable accessibilityRole="button"
        accessibilityLabel={remaining === 1 ? 'Voir l’autre photo' : `Voir les ${remaining} autres photos`}
        disabled={busy} onPress={() => onOpen(1)}
        style={({ pressed }) => [gallery.tile, gallery.more, pressed && gallery.pressed]}>
        <PhotoImage role={role} request={request} path={photoPath(articlePath, second.id, 'thumb')} label={photoLabel(second, 1)} />
        <View pointerEvents="none" style={gallery.shade}>
          <Ionicons name="images-outline" size={22} color="#fff" accessible={false} aria-hidden />
          <Text style={gallery.count}>+{remaining}</Text>
        </View>
      </Pressable>}
    </View>
  );
}

function CarouselButton({ icon, label, onPress }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={({ pressed }) => [gallery.control, pressed && gallery.pressed]}>
    <Ionicons name={icon} size={24} color="#fff" accessible={false} aria-hidden />
  </Pressable>;
}

export function PhotoCarousel({ article, articlePath, index, onChange, onClose, request, role }) {
  const photos = article?.photos ?? [];
  const current = index === null ? null : photos[index];
  const latest = useRef(null);

  function navigate(offset) {
    if (photos.length > 1 && index !== null) onChange((index + offset + photos.length) % photos.length);
  }
  latest.current = { navigate, onClose };

  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 16 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderRelease: (_event, gesture) => {
      if (Math.abs(gesture.dx) >= 42) latest.current.navigate(gesture.dx < 0 ? 1 : -1);
    },
  })).current;

  useEffect(() => {
    if (!current || Platform.OS !== 'web') return undefined;
    function keyboard(event) {
      if (event.key === 'Escape') latest.current.onClose();
      if (event.key === 'ArrowRight') latest.current.navigate(1);
      if (event.key === 'ArrowLeft') latest.current.navigate(-1);
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [Boolean(current)]);

  if (!current) return null;
  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={gallery.modal}>
        <View style={gallery.bar}>
          <Text accessibilityRole="header" style={gallery.title} numberOfLines={2}>{article.title}</Text>
          <CarouselButton icon="close-outline" label="Fermer le carrousel" onPress={onClose} />
        </View>
        <View style={gallery.stage} {...swipe.panHandlers}>
          <PhotoImage key={current.id} role={role} request={request}
            path={photoPath(articlePath, current.id, 'full')} label={photoLabel(current, index)} fit="contain" eager />
        </View>
        {current.description ? <Text style={gallery.description}>{current.description}</Text> : null}
        <View style={gallery.footer}>
          {photos.length > 1 && <CarouselButton icon="chevron-back-outline" label="Photo précédente" onPress={() => navigate(-1)} />}
          <Text accessibilityLiveRegion="polite" style={gallery.position}>Photo {index + 1} sur {photos.length}</Text>
          {photos.length > 1 && <CarouselButton icon="chevron-forward-outline" label="Photo suivante" onPress={() => navigate(1)} />}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const gallery = StyleSheet.create({
  preview: { flexDirection: 'row', gap: 7, aspectRatio: 1.65, width: '100%' },
  tile: { overflow: 'hidden', borderRadius: 12, backgroundColor: '#dce7d9', position: 'relative' },
  cover: { flex: 3 },
  more: { flex: 1.25 },
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(7,24,17,0.55)', alignItems: 'center', justifyContent: 'center', gap: 4 },
  count: { color: '#fff', fontSize: 25, fontWeight: '800' },
  pressed: { opacity: 0.78 },
  modal: { flex: 1, backgroundColor: '#132a22' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  title: { flex: 1, color: '#fff7e8', fontSize: 18, fontWeight: '700' },
  stage: { flex: 1, minHeight: 0, backgroundColor: '#091911', ...Platform.select({ web: { touchAction: 'pan-y' } }) },
  control: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#2c5041' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 14 },
  position: { color: '#fff7e8', fontSize: 15, fontWeight: '700' },
  description: { color: '#fff7e8', fontSize: 15, paddingHorizontal: 20, paddingTop: 9, textAlign: 'center' },
});
