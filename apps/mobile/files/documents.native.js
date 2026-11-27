import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Button, styles } from '../parent/ui';
import { RequestError } from '../parent/http';

const defaultLimit = 5 * 1024 * 1024;
const defaultFormats = 'image/jpeg,image/png,image/webp,application/pdf';
const extensions = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3' };
const folder = () => new Directory(Paths.cache, 'open-cartable-documents');

function remove(item) {
  try { if (item.exists) item.delete(); } catch { /* Le cache de l’application peut être nettoyé par le système. */ }
}

export function cleanupTemporaryDocuments() {
  remove(folder());
}

export function FileButton({ label, onFile, busy, accept = defaultFormats, limit = defaultLimit }) {
  const pending = useRef(false);
  const mounted = useRef(false);
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function pick() {
    if (pending.current) return;
    pending.current = true;
    setPicking(true);
    setProblem('');
    let copy;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: accept.split(',').filter((item) => item.includes('/')), copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      copy = new File(asset.uri);
      const size = copy.size;
      if (!size || size > limit) {
        setProblem('Choisissez un fichier de ' + limit / 1024 ** 2 + ' Mo maximum.');
        return;
      }
      const data = await copy.base64();
      if (mounted.current) onFile({ name: asset.name, type: asset.mimeType ?? '', size, data });
    } catch {
      setProblem('Impossible de lire ce fichier. Choisissez un autre document.');
    } finally {
      if (copy) remove(copy);
      pending.current = false;
      setPicking(false);
    }
  }

  return <>
    <Button label={label} icon="attach-outline" secondary busy={busy || picking} onPress={() => void pick()} />
    {problem && <Text accessibilityRole="alert" style={styles.error}>{problem}</Text>}
  </>;
}

export async function encodedFile(file, limit = defaultLimit) {
  if (!file.size || file.size > limit) throw new RequestError(413);
  return file.data;
}

export function temporaryDocument(document, name, extension = extensions[document.type]) {
  if (!extension || !document.bytes.length || document.bytes.length > 24 * 1024 * 1024) throw new RequestError(415);
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
  const directory = new Directory(folder(), Date.now() + '-' + Math.random().toString(36).slice(2));
  directory.create({ intermediates: true });
  const dispose = () => remove(directory);
  try {
    const file = new File(directory, safeName + '.' + extension);
    file.write(document.bytes);
    return { uri: file.uri, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export async function downloadDocument(document, name, extension) {
  if (!await Sharing.isAvailableAsync()) throw new RequestError(503);
  const { uri, dispose } = temporaryDocument(document, name, extension);
  try {
    await Sharing.shareAsync(uri, { dialogTitle: 'Ouvrir ou enregistrer le document', mimeType: document.type });
  } finally {
    // Certaines applications ouvrent la copie après la fermeture du sélecteur.
    setTimeout(dispose, 60_000);
  }
}
