import React, { useId, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, styles } from '../parent/ui';

const grid = 10_000;
const maxMasks = 20;
const middle = { x: grid / 2, y: grid / 2 };
const arrowKeys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const screenReader = { position: 'absolute', clipPath: 'inset(50%)', width: 1, height: 1, overflow: 'hidden' };

function clamp(value) {
  return Math.min(grid, Math.max(0, Math.round(value)));
}

function point(event) {
  const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
  return { x: clamp((event.clientX - left) / width * grid), y: clamp((event.clientY - top) / height * grid) };
}

function rectangle(first, last) {
  return { left: Math.min(first.x, last.x), right: Math.max(first.x, last.x),
    top: Math.min(first.y, last.y), bottom: Math.max(first.y, last.y) };
}

function percent(value) {
  return value / grid * 100 + '%';
}

function Mask({ area }) {
  return <div aria-hidden="true" style={{
    position: 'absolute', pointerEvents: 'none', backgroundColor: '#000', boxShadow: 'inset 0 0 0 1px #fff',
    left: percent(area.left), top: percent(area.top),
    width: percent(area.right - area.left), height: percent(area.bottom - area.top),
  }} />;
}

export function PhotoMasks({ path, label, busy, onApply, onClose }) {
  const hint = useId();
  const drag = useRef(null);
  const [size, setSize] = useState(null);
  const [failed, setFailed] = useState(false);
  const [masks, setMasks] = useState([]);
  const [draft, setDraft] = useState(null);
  const [keyboard, setKeyboard] = useState(null);
  const [corner, setCorner] = useState(null);
  const editable = size && !busy && masks.length < maxMasks;

  function place(area) {
    if (area.left === area.right || area.top === area.bottom) return;
    setMasks((before) => before.length < maxMasks ? [...before, area] : before);
  }

  function cancelDraw() {
    drag.current = null;
    setDraft(null);
  }

  function start(event) {
    if (!editable || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setKeyboard(null);
    setCorner(null);
    drag.current = { id: event.pointerId, start: point(event) };
  }

  function move(event) {
    if (drag.current?.id === event.pointerId) setDraft(rectangle(drag.current.start, point(event)));
  }

  function finish(event) {
    if (drag.current?.id !== event.pointerId) return;
    if (editable) place(rectangle(drag.current.start, point(event)));
    cancelDraw();
  }

  function keyDown(event) {
    if (event.key === 'Escape') {
      setKeyboard(null);
      setCorner(null);
      setDraft(null);
      return;
    }
    if (!editable || drag.current || ![...Object.keys(arrowKeys), 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    const cursor = keyboard ?? middle;
    if (event.key === 'Enter' || event.key === ' ') {
      if (event.repeat) return;
      if (!corner) {
        setKeyboard(cursor);
        setCorner(cursor);
      } else {
        const area = rectangle(corner, cursor);
        if (area.left === area.right || area.top === area.bottom) return;
        place(area);
        setCorner(null);
        setDraft(null);
      }
    } else {
      const [dx, dy] = arrowKeys[event.key];
      const step = event.shiftKey ? 500 : 100;
      const next = { x: clamp(cursor.x + dx * step), y: clamp(cursor.y + dy * step) };
      setKeyboard(next);
      if (corner) setDraft(rectangle(corner, next));
    }
  }

  const width = size ? `min(100%, ${size.width}px, ${48 * size.width / size.height}dvh)` : '100%';

  return <>
    <Text accessibilityRole="header" style={styles.label}>Masquer une zone</Text>
    <Text style={styles.body}>Tracez un rectangle sur chaque zone à masquer.</Text>
    <div id={hint} style={screenReader}>
      Au clavier, déplacez le curseur avec les flèches. Appuyez sur Entrée pour poser chaque coin. Échap annule le tracé en cours.
    </div>
    {failed && <Text accessibilityRole="alert" style={styles.error}>La photo n’a pas pu être chargée.</Text>}
    <div role="group" aria-label="Surface de masquage" aria-describedby={hint} tabIndex={editable ? 0 : -1}
      onPointerDown={start} onPointerMove={move} onPointerUp={finish}
      onPointerCancel={cancelDraw} onLostPointerCapture={cancelDraw} onKeyDown={keyDown}
      onBlur={() => { setKeyboard(null); setCorner(null); if (!drag.current) setDraft(null); }}
      style={{ position: 'relative', width, maxWidth: '100%', alignSelf: 'center',
        backgroundColor: '#dce7d9', touchAction: 'none', userSelect: 'none', cursor: editable ? 'crosshair' : 'auto',
        display: failed ? 'none' : 'block' }}>
      <img src={'/api/v1/teacher' + path} alt={label} draggable={false}
        onLoad={({ currentTarget }) => setSize({ width: currentTarget.naturalWidth, height: currentTarget.naturalHeight })}
        onError={() => setFailed(true)}
        style={{ width: '100%', height: 'auto', display: 'block', pointerEvents: 'none' }} />
      {masks.map((area, index) => <Mask key={index} area={area} />)}
      {draft && <Mask area={draft} />}
      {keyboard && editable && <div aria-hidden="true" style={{
        position: 'absolute', pointerEvents: 'none', width: 12, height: 12, border: '2px solid white',
        borderRadius: '50%', boxShadow: '0 0 0 2px #17372d', transform: 'translate(-50%, -50%)',
        left: percent(keyboard.x), top: percent(keyboard.y),
      }} />}
    </div>
    {masks.length > 0 && <Text accessibilityLiveRegion="polite" style={styles.label}>
      {masks.length === 1 ? '1 zone tracée' : masks.length + ' zones tracées'}
      {masks.length === maxMasks ? ' · Limite atteinte' : ''}
    </Text>}
    {masks.length > 0 && <Text style={styles.body}>L’enregistrement remplace la photo. Vérifiez-la de nouveau avant de publier.</Text>}
    <View style={styles.actions}>
      <Button label="Appliquer les masques" icon="checkmark-outline" busy={busy || !masks.length} onPress={() => onApply(masks)} />
      {masks.length > 0 && <Button label="Annuler le dernier tracé" icon="arrow-undo-outline" secondary busy={busy}
        onPress={() => setMasks((before) => before.slice(0, -1))} />}
      <Button label="Fermer" secondary busy={busy} onPress={onClose} />
    </View>
  </>;
}
