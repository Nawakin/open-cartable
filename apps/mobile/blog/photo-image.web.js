import React from 'react';

export function PhotoImage({ role, path, label, fit = 'cover', eager = false }) {
  return <img src={'/api/v1/' + role + path} alt={label} loading={eager ? 'eager' : 'lazy'}
    draggable={false} style={{ display: 'block', width: '100%', height: '100%', objectFit: fit }} />;
}
