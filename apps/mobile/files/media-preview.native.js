import React, { useEffect, useState } from 'react';
import { Image, Text } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Button, styles } from '../parent/ui';
import { temporaryDocument } from './documents';

const extensions = { image: 'jpg', video: 'mp4', audio: 'mp3' };

function Player({ uri, entry }) {
  const player = useVideoPlayer(uri);
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  if (status === 'error') return <Text accessibilityRole="alert" style={styles.error}>Ce média n’a pas pu être lu.</Text>;
  if (entry.kind === 'audio') return <Button label={isPlaying ? 'Mettre en pause' : 'Écouter'} busy={status !== 'readyToPlay'}
    icon={isPlaying ? 'pause-outline' : 'play-outline'} secondary onPress={() => isPlaying ? player.pause() : player.play()} />;
  return <VideoView player={player} fullscreenOptions={{ enable: true }} nativeControls accessibilityLabel={entry.title}
    style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: '#142720' }} />;
}

export function MediaPreview({ entry, path, request, onExpired }) {
  const [uri, setUri] = useState(null);
  const [problem, setProblem] = useState(false);
  useEffect(() => {
    let current = true;
    let document;
    async function load() {
      try {
        const file = await request(path, { responseType: 'attachment' });
        if (!current) return;
        document = temporaryDocument(file, 'apercu', extensions[entry.kind]);
        setUri(document.uri);
      } catch (error) {
        if (!current) return;
        if (error.status === 401) onExpired();
        else setProblem(true);
      }
    }
    void load();
    return () => { current = false; document?.dispose(); };
  }, [path, request, entry.kind]);
  if (problem) return <Text accessibilityRole="alert" style={styles.error}>L’aperçu est indisponible.</Text>;
  if (!uri) return <Text accessibilityLiveRegion="polite" style={styles.body}>Chargement de l’aperçu…</Text>;
  if (entry.kind === 'image') return <Image source={{ uri }} resizeMode="contain" accessibilityLabel={entry.title}
    style={{ width: '100%', height: 300, borderRadius: 10, backgroundColor: '#ebf2e9' }} />;
  return <Player uri={uri} entry={entry} />;
}
