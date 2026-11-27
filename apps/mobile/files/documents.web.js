import React, { useRef } from 'react';
import { Button } from '../parent/ui';
import { RequestError } from '../parent/http';

export function FileButton({ label, onFile, busy, accept = 'image/jpeg,image/png,image/webp,application/pdf' }) {
  const input = useRef(null);
  return <>
    <input ref={input} type="file" accept={accept} hidden disabled={busy} onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) onFile(file);
    }} />
    <Button label={label} icon="attach-outline" secondary busy={busy} onPress={() => input.current?.click()} />
  </>;
}

export async function encodedFile(file, limit = 5 * 1024 * 1024) {
  if (!file.size || file.size > limit) throw new RequestError(413);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new RequestError(415));
    reader.readAsDataURL(file);
  });
}

export function downloadDocument(file, name, extension) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(file);
  const types = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3' };
  link.href = url;
  link.download = name + '.' + (extension ?? types[file.type] ?? 'bin');
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function cleanupTemporaryDocuments() {}
