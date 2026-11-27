import React from 'react';

export function MediaPreview({ entry, source }) {
  if (entry.kind === 'video') return <video aria-label={entry.title} controls playsInline src={source}
    style={{ width: '100%', maxHeight: 430, borderRadius: 10, background: '#142720' }} />;
  if (entry.kind === 'audio') return <audio aria-label={entry.title} controls src={source} style={{ width: '100%' }} />;
  if (entry.kind === 'image') return <img alt={entry.title} src={source + '?preview=1'}
    style={{ display: 'block', maxWidth: '100%', maxHeight: 480, objectFit: 'contain' }} />;
  return <iframe title={entry.title} src={source + '?preview=1'}
    style={{ width: '100%', minHeight: 450, border: 0, borderRadius: 10 }} />;
}
