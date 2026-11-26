import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, styles } from '../parent/ui';
import { layout, levelChoices, Select } from './ui';

const departure = 'departure';
const targetValue = (target) => target ? target.classId + ':' + target.level : departure;

function description(student, classes) {
  if (student.assignment && !student.assignment.target) return 'Départ validé';
  const place = student.assignment?.target ?? student.proposal;
  if (!place) return (student.level ? student.level + ' · ' : '') + 'À vérifier';
  const name = classes.find(({ id }) => id === place.classId).name;
  const state = student.assignment
    ? (student.level === place.level ? 'Maintien validé' : 'Affectation validée') : 'Passage proposé';
  return state + ' · ' + place.level + ' · ' + name;
}

function PupilEditor({ student, source, plan, levels, save, busy }) {
  const [level, setLevel] = useState(student.override ?? '');
  const proposal = student.assignment ? student.assignment.target : student.proposal;
  const [target, setTarget] = useState(() =>
    student.assignment || proposal ? targetValue(proposal) : '');
  const changedLevel = level !== (student.override ?? '');
  const decisions = plan.assignments.filter(({ studentId }) => studentId !== student.id);
  const identity = { studentId: student.id, sourceClassId: source.id };

  function changeLevel() {
    const overrides = plan.overrides.filter(({ studentId }) => studentId !== student.id);
    if (level) overrides.push({ ...identity, level });
    void save({ overrides });
  }

  function confirm() {
    const [classId, nextLevel] = target.split(':');
    const next = target === departure ? null : { classId, level: nextLevel };
    void save({ assignments: [...decisions, { ...identity, sourceLevel: student.level, target: next }] });
  }

  return <>
    <Select label="Niveau actuel de l’élève" value={level} onChange={setLevel} disabled={busy}
      choices={levelChoices(levels, source.level ? 'Niveau de la classe · ' + source.level : 'Niveau à préciser')} />
    {changedLevel ? <View style={styles.actions}>
      <Button label="Enregistrer le niveau" icon="checkmark-outline" busy={busy} onPress={changeLevel} />
    </View> : <>
      <Select label="Décision pour la rentrée" value={target} onChange={setTarget} disabled={busy}
        choices={[
          { value: '', label: 'Choisir une destination' },
          ...plan.classes.flatMap(({ id, name, levels: choices }) =>
            choices.map((entry) => ({ value: targetValue({ classId: id, level: entry }), label: name + ' · ' + entry }))),
          { value: departure, label: 'Départ de l’école' },
        ]} />
      <View style={styles.actions}>
        {(!student.assignment || target !== targetValue(student.assignment.target)) &&
          <Button label="Valider la décision" icon="checkmark-outline" onPress={confirm} busy={busy || !target} />}
        {student.assignment && <Button label="Retirer la validation" secondary busy={busy}
          onPress={() => void save({ assignments: decisions })} />}
      </View>
    </>}
  </>;
}

function SourceClass({ source, plan, levels, save, busy }) {
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState(false);
  const [defaultLevel, setDefaultLevel] = useState(source.level ?? '');
  const confirmed = source.students.filter(({ assignment }) => assignment).length;
  const pending = source.students.filter(({ assignment }) => !assignment);
  const proposals = pending.filter(({ proposal }) => proposal);

  function saveDefault() {
    const sourceLevels = plan.sourceLevels.filter(({ classId }) => classId !== source.id);
    if (defaultLevel) sourceLevels.push({ classId: source.id, level: defaultLevel });
    void save({ sourceLevels });
  }

  function confirmProposals() {
    void save({ assignments: [...plan.assignments, ...proposals.map((student) => ({
      studentId: student.id, sourceClassId: source.id, sourceLevel: student.level, target: student.proposal,
    }))] });
  }

  return <View style={layout.group}>
    <Select label="Niveau actuel de la classe" value={defaultLevel} onChange={setDefaultLevel} disabled={busy}
      choices={levelChoices(levels, 'Préciser les niveaux par élève')} />
    {defaultLevel !== (source.level ?? '') && <View style={styles.actions}>
      <Button label="Enregistrer le niveau de la classe" icon="checkmark-outline" busy={busy} onPress={saveDefault} />
    </View>}
    <Text accessibilityLiveRegion="polite" style={styles.label}>
      {confirmed} {confirmed > 1 ? 'décisions validées' : 'décision validée'} sur {source.students.length}
    </Text>
    {Boolean(confirmed) && <View style={styles.actions}>
      <Button label={filter ? 'Afficher tous les élèves' : 'Afficher seulement à vérifier'} icon="filter-outline"
        busy={busy} onPress={() => setFilter(!filter)} secondary />
    </View>}
    {(filter ? pending : source.students).map((student) => {
      const detail = description(student, plan.classes);
      const expanded = open === student.id;
      return <View key={student.id} style={layout.card}>
        <Pressable accessibilityRole="button" accessibilityLabel={student.displayName + ' · ' + detail}
          aria-expanded={expanded} disabled={busy} onPress={() => setOpen(expanded ? null : student.id)}
          style={({ pressed }) => [layout.cardHeader, pressed && layout.pressed]}>
          <Ionicons name={student.assignment ? 'checkmark-circle-outline' : 'person-outline'} size={21} color="#225344"
            accessible={false} aria-hidden />
          <View style={layout.details}>
            <Text style={styles.label}>{student.displayName}</Text>
            <Text style={layout.status}>{detail}</Text>
          </View>
          <Ionicons name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'} size={18} color="#225344"
            accessible={false} aria-hidden />
        </Pressable>
        {expanded && <PupilEditor key={plan.revision} student={student} source={source}
          plan={plan} levels={levels} save={save} busy={busy} />}
      </View>;
    })}
    {!source.students.length && <Text style={styles.body}>Cette classe ne compte aucun élève.</Text>}
    {filter && !pending.length && <Text style={styles.body}>Toutes les décisions sont validées pour cette classe.</Text>}
    {proposals.length > 0 && <View style={styles.actions}>
      <Button label={proposals.length === 1 ? 'Valider la proposition de cette classe' : `Valider les ${proposals.length} propositions de cette classe`}
        icon="checkmark-outline" busy={busy} onPress={confirmProposals} />
    </View>}
  </View>;
}

export function Passages({ sources, plan, levels, save, busy }) {
  const [sourceId, setSourceId] = useState(sources.length === 1 ? sources[0].id : '');
  const source = sources.find(({ id }) => id === sourceId);
  return <View style={layout.group}>
    <Text accessibilityRole="header" style={layout.heading}>Vérifier les passages</Text>
    {sources.length > 1 && <Select label="Classe actuelle" value={sourceId} disabled={busy} onChange={setSourceId}
      choices={[{ value: '', label: 'Choisir une classe' }, ...sources.map(({ id, name }) => ({ value: id, label: name }))]} />}
    {!sources.length && <Text style={styles.body}>Aucune classe à préparer dans cette école.</Text>}
    {source && <>
      <Text style={styles.label}>{source.name} · {source.students.length} {source.students.length > 1 ? 'élèves' : 'élève'} actuellement</Text>
      <SourceClass key={source.id + '/' + (source.level ?? '')} source={source} plan={plan} levels={levels} save={save} busy={busy} />
    </>}
  </View>;
}
