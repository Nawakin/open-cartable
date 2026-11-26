import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { layout, Select } from './ui';

export function ClosingYear({ plan, teachers, summary, save, apply, busy }) {
  const [teacherId, setTeacherId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const teacher = teachers.find(({ id }) => id === teacherId);
  const assigned = plan.teacherAssignments.filter((entry) => entry.teacherId === teacherId);
  const unavailable = plan.teacherAssignments.filter(({ teacherId: id }) => !teachers.some((entry) => entry.id === id));
  const next = String(plan.startYear + 1);

  function toggle(classId) {
    const exists = assigned.some((entry) => entry.classId === classId);
    const teacherAssignments = exists
      ? plan.teacherAssignments.filter((entry) => entry.teacherId !== teacherId || entry.classId !== classId)
      : [...plan.teacherAssignments, { teacherId, classId }];
    void save({ teacherAssignments });
  }

  return <View style={layout.group}>
    <Text accessibilityRole="header" style={layout.heading}>Affectations et ouverture</Text>
    <Text style={styles.body}>Choisissez les classes de rentrée de chaque enseignant.</Text>
    {teachers.length > 0 && <Select label="Choisir un enseignant" value={teacherId} disabled={busy} onChange={setTeacherId}
      choices={[{ value: '', label: 'Choisir un enseignant' }, ...teachers.map(({ id, login }) => ({ value: id, label: login }))]} />}
    {teacher && <View style={layout.card}>
      <Text style={styles.label}>{teacher.login}</Text>
      {!teacher.active && <Text style={styles.body}>Compte à activer.</Text>}
      <View style={styles.actions}>
        {plan.classes.map(({ id, name }) => {
          const selected = assigned.some(({ classId }) => classId === id);
          return <Button key={id} label={name} selected={selected} secondary={!selected}
            accessibilityLabel={(selected ? 'Retirer l’affectation à ' : 'Affecter à ') + name}
            busy={busy} onPress={() => toggle(id)} />;
        })}
      </View>
    </View>}
    {unavailable.length > 0 && <View style={styles.actions}>
      <Button label="Retirer les affectations de comptes supprimés" secondary busy={busy}
        onPress={() => void save({ teacherAssignments: plan.teacherAssignments.filter((entry) => !unavailable.includes(entry)) })} />
    </View>}
    <View style={layout.card}>
      <Text accessibilityRole="header" style={layout.heading}>Récapitulatif</Text>
      <Text style={styles.body}>{plan.classes.length} classe(s) · {summary.moved} passage(s) · {summary.departed} départ(s)</Text>
      <Text style={styles.body}>{summary.pending} décision(s) à vérifier sur {summary.total} élèves</Text>
      <Text style={styles.body}>{teachers.filter(({ id }) => !plan.teacherAssignments.some(({ teacherId: assignedId }) => assignedId === id)).length}
        {' compte(s) enseignant(s) sans classe pour la rentrée'}</Text>
      {confirming ? <>
        <Text style={styles.body}>L’ouverture applique ces passages et place les classes actuelles en archive.</Text>
        <Field label="Année de début de la rentrée" placeholder={next} value={confirmation} onChangeText={setConfirmation}
          keyboardType="number-pad" maxLength={4} editable={!busy} />
        <View style={styles.actions}>
          <Button label="Confirmer l’ouverture" icon="checkmark-outline" busy={busy || !summary.ready || confirmation !== next}
            onPress={() => apply(Number(confirmation))} />
          <Button label="Annuler" secondary busy={busy} onPress={() => setConfirming(false)} />
        </View>
      </> : <View style={styles.actions}>
        <Button label="Ouvrir la nouvelle année" icon="arrow-forward-outline" busy={busy || !summary.ready}
          onPress={() => setConfirming(true)} />
      </View>}
    </View>
  </View>;
}
