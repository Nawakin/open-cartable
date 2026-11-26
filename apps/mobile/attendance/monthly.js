import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, styles } from '../parent/ui';
import {
  AttendanceRow, attendance, classAttendancePath, ClassPicker, formatDay, MonthPicker, schoolDay, statuses, useAttendanceTask,
} from './ui';

function useAttendanceMonth(path, request, onExpired) {
  const [month, setMonth] = useState(() => schoolDay().slice(0, 7));
  const [data, setData] = useState(null);
  const task = useAttendanceTask(onExpired);
  const load = async () => {
    setData(null);
    setData(await request(path + '?month=' + month));
  };
  const refresh = () => { if (path) void task.run(load); };
  function changeMonth(value) {
    setData(null);
    setMonth(value);
  }
  useEffect(() => { refresh(); }, [path, month]);
  return { ...task, month, changeMonth, data, clear: () => setData(null), load, refresh };
}

function Entry({ entry, children, includeClass = false }) {
  const status = statuses[entry.status];
  const detail = [status.label, entry.status === 'absent' ? (entry.justified ? 'Justifiée' : 'Non justifiée') : null,
    includeClass ? entry.className : null].filter(Boolean).join(' · ');
  return <AttendanceRow title={formatDay(entry.day)} detail={detail} icon={status.icon}>{children}</AttendanceRow>;
}

export function ParentAttendance({ child, request, onBack, onExpired }) {
  const path = '/children/' + encodeURIComponent(child.id) + '/attendance';
  const page = useAttendanceMonth(path, request, onExpired);
  return <View style={styles.panel}>
    <View style={styles.actions}>
      <Button label="Retour" accessibilityLabel="Retour à vos enfants" icon="arrow-back-outline" secondary onPress={onBack} />
    </View>
    <Text accessibilityRole="header" style={styles.title}>Absences</Text>
    <Text style={styles.body}>{child.displayName}</Text>
    <MonthPicker month={page.month} onChange={page.changeMonth} busy={page.busy} />
    {page.error && <Text accessibilityRole="alert" style={styles.error}>{page.error}</Text>}
    {page.busy && !page.data && <Text style={styles.body}>Chargement de l’historique…</Text>}
    {page.data && !page.data.entries.length && <Text style={styles.body}>Aucune absence, aucun retard ni aucune sortie enregistrés.</Text>}
    <View style={attendance.list}>
      {page.data?.entries.map((entry) => <Entry key={entry.day + entry.classId} entry={entry} includeClass />)}
    </View>
    <View style={styles.actions}>
      <Button label="Actualiser" icon="refresh-outline" secondary busy={page.busy} onPress={page.refresh} />
    </View>
  </View>;
}

function tally({ absences, late, left }) {
  return [absences && (absences === 1 ? '1 absence' : absences + ' absences'),
    late && (late === 1 ? '1 retard' : late + ' retards'),
    left && (left === 1 ? '1 sortie' : left + ' sorties')].filter(Boolean).join(' · ');
}

export function DirectionAttendance({ classes, request, onExpired }) {
  const [classId, setClassId] = useState(classes.length === 1 ? classes[0].id : null);
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState('');
  const path = classId ? classAttendancePath(classId) : null;
  const page = useAttendanceMonth(path, request, onExpired);
  const threshold = page.data?.alertThreshold;
  const alerts = page.data?.students.filter(({ unjustified }) => unjustified >= threshold).length ?? 0;

  function setJustified(studentId, entry) {
    void page.run(async () => {
      setNotice('');
      await request(path + '/' + entry.day + '/students/' + encodeURIComponent(studentId), {
        method: 'PUT', body: { revision: entry.revision, justified: !entry.justified },
      });
      await page.load();
      setNotice(entry.justified ? 'Justification retirée.' : 'Absence marquée comme justifiée.');
    });
  }

  return <>
    <Text accessibilityRole="header" style={styles.title}>Suivi des absences</Text>
    <ClassPicker classes={classes} classId={classId} busy={page.busy} onSelect={(id) => {
      if (id !== classId) { page.clear(); setOpen(null); setNotice(''); setClassId(id); }
    }} />
    {path && <>
      <MonthPicker month={page.month} busy={page.busy} onChange={(month) => {
        setOpen(null); setNotice(''); page.changeMonth(month);
      }} />
      {page.error && <Text accessibilityRole="alert" style={styles.error}>{page.error}</Text>}
      {notice && <Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text>}
      {page.busy && !page.data && <Text style={styles.body}>Chargement du suivi…</Text>}
      {alerts > 0 && <Text accessibilityLiveRegion="polite" style={attendance.alert}>{alerts === 1
        ? `1 élève a au moins ${threshold} absences non justifiées sur le mois affiché.`
        : `${alerts} élèves ont au moins ${threshold} absences non justifiées sur le mois affiché.`}</Text>}
      {page.data && !page.data.students.length && <Text style={styles.body}>Aucune absence, aucun retard ni aucune sortie enregistrés.</Text>}
      <View style={attendance.list}>
        {page.data?.students.map((student) => <AttendanceRow key={student.id} title={student.displayName}
          detail={tally(student)} icon={student.unjustified >= threshold ? 'alert-circle-outline' : 'person-outline'}
          busy={page.busy} selected={open === student.id} onPress={() => setOpen(open === student.id ? null : student.id)}>
          {open === student.id && <View style={[attendance.controls, attendance.list]}>
            {student.entries.map((entry) => <Entry key={entry.day} entry={entry}>
              {entry.status === 'absent' && <View style={[styles.actions, attendance.controls]}>
                <Button label={entry.justified ? 'Retirer la justification' : 'Marquer comme justifiée'}
                  accessibilityLabel={(entry.justified ? 'Retirer la justification · ' : 'Marquer comme justifiée · ') + formatDay(entry.day)}
                  icon={entry.justified ? 'close-circle-outline' : 'checkmark-outline'} busy={page.busy}
                  secondary onPress={() => setJustified(student.id, entry)} />
              </View>}
            </Entry>)}
          </View>}
        </AttendanceRow>)}
      </View>
      <View style={styles.actions}>
        <Button label="Actualiser" icon="refresh-outline" secondary busy={page.busy} onPress={page.refresh} />
      </View>
    </>}
  </>;
}
