import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { dayInSchoolCalendar } from '../parent/homework';
import { layout } from '../year-transition/ui';
import { formatLiaisonDay } from '../liaison/ui';
import { Problem, useSchoolTask } from './ui';

export function FamilyPlannedAbsences({ childId, request, onExpired }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [day, setDay] = useState(dayInSchoolCalendar);
  const [reason, setReason] = useState('');
  const [removing, setRemoving] = useState(null);
  const { busy, problem, run } = useSchoolTask(onExpired);
  const path = '/children/' + childId + '/planned-absences';

  async function load() {
    setEntries((await request(path)).absences);
  }

  return <View style={layout.card}>
    <Button label="Prévenir d’une absence" icon="calendar-outline" secondary expanded={open} onPress={() => {
      setOpen(!open);
      if (!open) void run(load);
    }} />
    {open && <>
      <Problem value={problem} />
      <Field label="Date de l’absence" value={day} onChangeText={setDay} placeholder="AAAA-MM-JJ" maxLength={10} editable={!busy} />
      <Field label="Informations utiles pour l’école" value={reason} onChangeText={setReason} maxLength={300}
        placeholder="Facultatif" multiline editable={!busy} />
      <Button label="Prévenir l’école" busy={busy || !/^\d{4}-\d{2}-\d{2}$/.test(day)} onPress={() => void run(async () => {
        await request(path, { method: 'PUT', body: { day, reason } });
        setReason('');
        await load();
      })} />
      {entries.map((entry) => <View key={entry.day} style={layout.group}>
        <Text style={styles.label}>Absence annoncée · {formatLiaisonDay(entry.day)}</Text>
        {!!entry.reason && <Text style={styles.body}>{entry.reason}</Text>}
        <View style={styles.actions}>
          <Button label={removing === entry.day ? 'Confirmer le retrait' : 'Retirer le signalement'} secondary busy={busy}
            onPress={() => {
              if (removing !== entry.day) return setRemoving(entry.day);
              void run(async () => {
                await request(path + '/' + entry.day, { method: 'DELETE' });
                setRemoving(null);
                await load();
              });
            }} />
          {removing === entry.day && <Button label="Conserver" secondary onPress={() => setRemoving(null)} />}
        </View>
      </View>)}
    </>}
  </View>;
}

export function StaffPlannedAbsences({ request, onExpired }) {
  const [rows, setRows] = useState([]);
  const { busy, problem, run } = useSchoolTask(onExpired);

  function load() {
    void run(async () => setRows((await request('/planned-absences')).absences));
  }
  useEffect(load, []);
  return <View style={layout.group}>
    <Text accessibilityRole="header" style={styles.title}>Absences annoncées</Text>
    <Problem value={problem} />
    <Button label="Actualiser" secondary busy={busy} onPress={load} />
    {!busy && !rows.length && <Text style={styles.body}>Aucune absence annoncée pour les prochains jours.</Text>}
    {rows.map((row) => <View key={row.childId + '/' + row.day + '/' + row.guardianId} style={layout.card}>
      <Text style={styles.label}>{row.studentName} · {row.className}</Text>
      <Text style={layout.status}>{formatLiaisonDay(row.day)} · {row.guardianName || 'Responsable ' + row.guardianId.slice(-6)}</Text>
      {!!row.reason && <Text style={styles.body}>{row.reason}</Text>}
    </View>)}
  </View>;
}
