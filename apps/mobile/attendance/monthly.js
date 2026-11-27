import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, styles } from '../parent/ui';
import {
  AttendanceRow, attendance, classAttendancePath, ClassPicker, formatDay, MonthPicker, schoolDay, statuses, useAttendanceTask,
} from './ui';
import { downloadDocument, encodedFile, FileButton } from '../files/documents';

const justificationLabels = { pending: 'Justificatif reçu', accepted: 'Justificatif accepté', refused: 'Justificatif refusé' };

function useAttendanceMonth(path, request, onExpired, initialMonth) {
  const [month, setMonth] = useState(() => initialMonth ?? schoolDay().slice(0, 7));
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
    includeClass ? entry.className : null, justificationLabels[entry.justificationStatus]].filter(Boolean).join(' · ');
  return <AttendanceRow title={formatDay(entry.day)} detail={detail} icon={status.icon}>{children}</AttendanceRow>;
}

export function ParentAttendance({ child, request, onBack, onExpired, initialMonth }) {
  const path = '/children/' + encodeURIComponent(child.id) + '/attendance';
  const page = useAttendanceMonth(path, request, onExpired, initialMonth);
  function submit(entry, file) {
    void page.run(async () => {
      const endpoint = path + '/' + encodeURIComponent(entry.classId) + '/' + entry.day + '/justification';
      await request(endpoint, { method: 'PUT', body: { content: await encodedFile(file) } });
      await page.load();
    });
  }
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
      {page.data?.entries.map((entry) => <Entry key={entry.day + entry.classId} entry={entry} includeClass>
        {entry.status === 'absent' && !entry.justified && <View style={[styles.actions, attendance.controls]}>
          <FileButton label={entry.justificationStatus ? 'Remplacer le justificatif' : 'Envoyer un justificatif'}
            busy={page.busy} onFile={(file) => submit(entry, file)} />
        </View>}
      </Entry>)}
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

  function setJustified(studentId, entry, decision) {
    void page.run(async () => {
      setNotice('');
      const url = path + '/' + entry.day + '/students/' + encodeURIComponent(studentId);
      await request(decision === undefined ? url : url + '/justification', {
        method: 'PUT', body: decision === undefined ? { revision: entry.revision, justified: !entry.justified }
          : { revision: entry.revision, accepted: decision },
      });
      await page.load();
      setNotice(decision === false ? 'Justificatif refusé.'
        : entry.justified ? 'Justification retirée.' : 'Absence marquée comme justifiée.');
    });
  }

  function download(studentId, entry) {
    void page.run(async () => {
      const url = path + '/' + entry.day + '/students/' + encodeURIComponent(studentId) + '/justification';
      const file = await request(url, { responseType: 'attachment' });
      await downloadDocument(file, 'justificatif-' + entry.day);
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
                {entry.justificationStatus && <Button label="Télécharger le justificatif" icon="download-outline"
                  busy={page.busy} secondary onPress={() => download(student.id, entry)} />}
                {entry.justificationStatus === 'pending' && <Button label="Refuser le justificatif" secondary
                  busy={page.busy} onPress={() => setJustified(student.id, entry, false)} />}
                <Button label={entry.justified ? 'Retirer la justification' : 'Marquer comme justifiée'}
                  accessibilityLabel={(entry.justified ? 'Retirer la justification · ' : 'Marquer comme justifiée · ') + formatDay(entry.day)}
                  icon={entry.justified ? 'close-circle-outline' : 'checkmark-outline'} busy={page.busy}
                  secondary onPress={() => setJustified(student.id, entry, entry.justificationStatus === 'pending' ? true : undefined)} />
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
