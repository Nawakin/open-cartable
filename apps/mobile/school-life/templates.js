import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { layout } from '../year-transition/ui';
import { Problem, useSchoolTask } from './ui';

export function TeachingTemplates({ kind, content, onApply, request, onExpired, disabled }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState(null);
  const { busy, problem, run } = useSchoolTask(onExpired);

  async function load() {
    setItems((await request('/templates?kind=' + kind)).templates);
  }

  return <View style={layout.group}>
    <View style={styles.actions}><Button label="Modèles" icon="copy-outline" secondary expanded={open} busy={disabled || busy}
      onPress={() => {
        setOpen(!open);
        if (!open) void run(load);
      }} /></View>
    {open && <View style={layout.card}>
      <Problem value={problem} />
      {items.map((item) => <View key={item.id} style={layout.cardHeader}>
        <Text style={[layout.details, styles.label]}>{item.name}</Text>
        <Button label="Utiliser" accessibilityLabel={'Utiliser le modèle ' + item.name} secondary busy={busy || disabled}
          onPress={() => { onApply(item.content); setOpen(false); }} />
        <Button label={removing === item.id ? 'Confirmer' : 'Retirer'} secondary busy={busy || disabled}
          accessibilityLabel={(removing === item.id ? 'Confirmer le retrait de ' : 'Retirer le modèle ') + item.name}
          onPress={() => {
            if (removing !== item.id) return setRemoving(item.id);
            void run(async () => {
              await request('/templates/' + item.id, { method: 'DELETE' });
              setRemoving(null);
              await load();
            });
          }} />
      </View>)}
      <Field label="Nom du modèle" value={name} onChangeText={setName} maxLength={80} editable={!busy && !disabled} />
      <Button label="Enregistrer le texte comme modèle" busy={busy || disabled || !name.trim()
        || Object.values(content).some((value) => !value.trim())}
        onPress={() => void run(async () => {
          await request('/templates', { method: 'POST', body: { kind, name, content } });
          setName('');
          await load();
        })} />
    </View>}
  </View>;
}
