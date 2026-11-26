import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { layout } from './ui';

export function ClassesForNextYear({ plan, sources, levels, save, busy, onReview }) {
  const [editing, setEditing] = useState(null);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const counts = new Map();
  for (const { students } of sources) {
    for (const { assignment, proposal } of students) {
      const target = assignment ? assignment.target : proposal;
      if (!target) continue;
      const entry = counts.get(target.classId) ?? { confirmed: 0, suggested: 0 };
      if (assignment) entry.confirmed += 1;
      else entry.suggested += 1;
      counts.set(target.classId, entry);
    }
  }

  async function saveClass(remove = false) {
    let classes;
    if (remove) classes = plan.classes.filter(({ id }) => id !== editing.id);
    else if (editing.id) classes = plan.classes.map((entry) => entry.id === editing.id ? editing : entry);
    else classes = [...plan.classes, editing];
    if (await save({ classes })) {
      setEditing(null);
      setConfirmRemoval(false);
    }
  }

  return <View style={layout.group}>
    <Text accessibilityRole="header" style={layout.heading}>Classes de rentrée</Text>
    {!plan.classes.length && <Text style={styles.body}>Ajoutez les classes et les niveaux prévus pour la rentrée.</Text>}
    {plan.classes.map((entry) => {
      const { confirmed = 0, suggested = 0 } = counts.get(entry.id) ?? {};
      return <View key={entry.id} style={[layout.card, layout.cardHeader]}>
        <View style={layout.details}>
          <Text style={styles.label}>{entry.name}</Text>
          <Text style={layout.status}>{entry.levels.join(' · ')}</Text>
          <Text style={layout.status}>{confirmed} validé{confirmed > 1 ? 's' : ''} · {suggested} proposé{suggested > 1 ? 's' : ''}</Text>
        </View>
        <Button label="Modifier" accessibilityLabel={'Modifier ' + entry.name} icon="create-outline" secondary
          busy={busy || Boolean(editing)} onPress={() => { setConfirmRemoval(false); setEditing(entry); }} />
      </View>;
    })}
    {editing ? <View style={layout.card}>
      <Field label="Nom de la classe de rentrée" value={editing.name} maxLength={100} editable={!busy}
        onChangeText={(name) => setEditing({ ...editing, name })} />
      <Text style={styles.label}>Niveaux de la classe</Text>
      <View style={styles.actions}>
        {levels.map((level) => {
          const selected = editing.levels.includes(level);
          return <Button key={level} label={level} selected={selected} icon={selected ? 'checkmark-outline' : undefined}
            secondary={!selected} busy={busy} onPress={() => setEditing({
              ...editing, levels: selected ? editing.levels.filter((entry) => entry !== level) : [...editing.levels, level],
            })} />;
        })}
      </View>
      {confirmRemoval && <Text style={styles.body}>Les décisions vers cette classe reviendront dans « À vérifier ».</Text>}
      <View style={styles.actions}>
        {confirmRemoval ? <Button label="Confirmer le retrait" onPress={() => void saveClass(true)} busy={busy} />
          : <Button label="Enregistrer la classe" icon="checkmark-outline" onPress={() => void saveClass()}
            busy={busy || !editing.name.trim() || !editing.levels.length} />}
        {editing.id && !confirmRemoval && <Button label="Retirer du brouillon" icon="trash-outline" secondary
          busy={busy} onPress={() => setConfirmRemoval(true)} />}
        <Button label="Annuler" secondary busy={busy} onPress={() => { setEditing(null); setConfirmRemoval(false); }} />
      </View>
    </View> : <View style={styles.actions}>
      <Button label="Ajouter une classe" icon="add-outline" secondary={plan.classes.length > 0}
        busy={busy} onPress={() => setEditing({ id: null, name: '', levels: [] })} />
      {plan.classes.length > 0 && <Button label="Vérifier les passages" icon="arrow-forward-outline" busy={busy}
        onPress={onReview} />}
    </View>}
  </View>;
}
