import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button, Field, styles } from '../parent/ui';
import { attendance, AttendanceRow, classAttendancePath, ClassPicker, schoolDay, statuses, useAttendanceTask } from './ui';

export function TeacherAttendance({ classes, request, onExpired }) {
  const [classId, setClassId] = useState(classes.length === 1 ? classes[0].id : null);
  const [day, setDay] = useState(schoolDay);
  const [roll, setRoll] = useState(null);
  const [marks, setMarks] = useState({});
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState('');
  const { run, busy, error } = useAttendanceTask(onExpired);
  const dirty = Object.keys(marks).length > 0;
  const path = classId && day.length === 10 ? classAttendancePath(classId) + '/' + encodeURIComponent(day) : null;

  function show(result) {
    setRoll(result);
    setMarks({});
    setOpen(null);
  }

  function refresh() {
    if (path) void run(async () => {
      setNotice('');
      show(null);
      show(await request(path));
    });
  }

  useEffect(() => { refresh(); }, [path]);

  function changeDate(date) {
    setRoll(null);
    setNotice('');
    setDay(date);
  }

  function record(student, status) {
    setNotice('');
    setOpen(null);
    setMarks((before) => {
      const next = { ...before };
      if (status === student.status) delete next[student.id];
      else next[student.id] = status;
      return next;
    });
  }

  function save() {
    void run(async () => {
      const entries = roll.students.map(({ id, status }) => ({ studentId: id, status: marks[id] ?? status }));
      show(await request(path, { method: 'PUT', body: { revision: roll.revision, entries } }));
      setNotice('Appel enregistré.');
    });
  }

  return <>
    <Text accessibilityRole="header" style={styles.title}>Faire l’appel</Text>
    <ClassPicker classes={classes} classId={classId} busy={busy || dirty}
      onSelect={(id) => { if (id !== classId) { setRoll(null); setClassId(id); } }} />
    {classId && <>
      {Platform.OS === 'web' ? <View style={styles.field}>
        <Text style={styles.label}>Date de l’appel</Text>
        <input type="date" aria-label="Date de l’appel" value={day} max={schoolDay()} disabled={busy || dirty}
          onChange={(event) => changeDate(event.target.value)}
          style={{ minHeight: 44, alignSelf: 'flex-start', fontSize: 16, padding: '0 10px', border: '1px solid #929e91', borderRadius: 8 }} />
      </View> : <Field label="Date de l’appel" value={day} maxLength={10} onChangeText={changeDate}
        editable={!busy && !dirty} />}
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {notice && <Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text>}
      {busy && !roll && <Text style={styles.body}>Chargement de l’appel…</Text>}
      {roll && !roll.students.length && <Text style={styles.body}>{roll.canStart
        ? 'Aucun élève dans cette classe.' : 'Aucun appel enregistré à cette date.'}</Text>}
      {!!roll?.students.length && <>
        {!roll.revision && <Text style={styles.body}>Tous les élèves sont présélectionnés comme présents. Touchez un nom pour modifier son statut.</Text>}
        <View style={attendance.list}>
          {roll.students.map((student) => {
            const status = marks[student.id] ?? student.status;
            return <AttendanceRow key={student.id} title={student.displayName} detail={statuses[status].label}
              icon={statuses[status].icon} busy={busy} selected={open === student.id}
              onPress={() => setOpen(open === student.id ? null : student.id)}>
              {open === student.id && <View style={[styles.actions, attendance.controls]}>
                {Object.entries(statuses).map(([id, { label, icon }]) => <Button key={id} label={label} icon={icon}
                  selected={status === id} secondary={status !== id} busy={busy} onPress={() => record(student, id)} />)}
              </View>}
            </AttendanceRow>;
          })}
        </View>
        <View style={styles.actions}>
          {(!roll.revision || dirty) && <Button label="Enregistrer l’appel" icon="checkmark-outline" busy={busy} onPress={save} />}
          {dirty && <Button label="Annuler les modifications" busy={busy} secondary onPress={() => show(roll)} />}
        </View>
      </>}
      {(error || (roll?.revision && !dirty)) && <View style={styles.actions}>
        <Button label="Actualiser" icon="refresh-outline" busy={busy} secondary onPress={refresh} />
      </View>}
    </>}
  </>;
}
