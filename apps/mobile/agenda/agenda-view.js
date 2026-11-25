import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { dayInSchoolCalendar, movePeriod, periodRange } from '../parent/homework';
import { Button, styles } from '../parent/ui';

const dayLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'UTC' });
const timeLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const parisTime = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short', timeZone: 'Europe/Paris' });
const scopeLabels = { school: 'École', class: 'Classe', private: 'Rendez-vous individuel' };

export function CalendarPeriod({ anchor, view, busy, onChange }) {
  const { from, to } = periodRange(anchor, view);
  return (
    <>
      <View style={styles.actions}>
        <Button label="Semaine" secondary={view !== 'week'} onPress={() => onChange(anchor, 'week')} busy={busy} />
        <Button label="Mois" secondary={view !== 'month'} onPress={() => onChange(anchor, 'month')} busy={busy} />
      </View>
      <Text style={agendaStyles.heading}>
        {dayLabel.format(new Date(from + 'T00:00:00Z'))} – {dayLabel.format(new Date(to + 'T00:00:00Z'))}
      </Text>
      <View style={styles.actions}>
        <Button label="Période précédente" onPress={() => onChange(movePeriod(anchor, view, -1), view)} busy={busy} secondary />
        <Button label="Aujourd’hui" onPress={() => onChange(dayInSchoolCalendar(), view)} busy={busy} secondary />
        <Button label="Période suivante" onPress={() => onChange(movePeriod(anchor, view, 1), view)} busy={busy} secondary />
      </View>
    </>
  );
}

export function AgendaEvent({ event, children }) {
  return (
    <View style={agendaStyles.event}>
      <Text style={agendaStyles.scope}>{scopeLabels[event.scope]}</Text>
      <Text accessibilityRole="header" style={agendaStyles.heading}>{event.title}</Text>
      <Text style={styles.body}>{timeLabel.format(new Date(event.startsAt))} → {timeLabel.format(new Date(event.endsAt))}</Text>
      {event.location ? <Text style={styles.body}>{event.location}</Text> : null}
      {event.description ? <Text style={styles.body}>{event.description}</Text> : null}
      {children}
    </View>
  );
}

export function AgendaReminders({ page, busy, error, onOpen, onMore }) {
  if (page.reminders.length === 0 && !error) return null;
  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Rappels d’agenda</Text>
      {page.reminders.length > 0 && <Text style={styles.body}>Horaires de Paris</Text>}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {page.reminders.map((reminder) => (
        <View key={reminder.id} style={agendaStyles.event}>
          <Text style={agendaStyles.scope}>
            {reminder.day === 'today' ? 'Aujourd’hui' : 'Demain'} à {parisTime.format(new Date(reminder.startsAt))}
          </Text>
          <Text style={agendaStyles.heading}>{reminder.title}</Text>
          <Text style={styles.body}>{scopeLabels[reminder.scope]}{reminder.scope === 'school' ? '' : ` · ${reminder.child.displayName}`}</Text>
          <Button label="Ouvrir l’agenda" accessibilityLabel={`Ouvrir l’agenda pour ${reminder.title}`}
            busy={busy} secondary onPress={() => onOpen(reminder)} />
        </View>
      ))}
      {page.nextCursor && <Button label="Afficher la suite des rappels" onPress={onMore} busy={busy} secondary />}
    </View>
  );
}

export function ParentAgenda({ calendar, busy, error, onChange, onMore, onBack, onLogout }) {
  const { child, anchor, view, events, nextCursor } = calendar;
  return (
    <View style={styles.panel}>
      <View style={styles.actions}>
        <Button label="Vos enfants" onPress={onBack} busy={busy} secondary />
        <Button label="Se déconnecter" onPress={onLogout} busy={busy} secondary />
      </View>
      <Text accessibilityRole="header" style={styles.title}>Agenda</Text>
      <Text style={styles.body}>{child.displayName} · {child.className}</Text>
      <CalendarPeriod anchor={anchor} view={view} busy={busy}
        onChange={(nextAnchor, nextView) => onChange({ ...calendar, anchor: nextAnchor, view: nextView })} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {busy && events.length === 0 && <Text accessibilityLiveRegion="polite" style={styles.body}>Chargement de l’agenda…</Text>}
      {!busy && !error && events.length === 0 && <Text style={styles.body}>Aucun événement pour cette période.</Text>}
      {events.map((event) => (
        <AgendaEvent key={event.id} event={event}>
          {Platform.OS === 'web' && (
            <Button label="Télécharger le fichier .ics" busy={busy} secondary
              accessibilityLabel={`Télécharger ${event.title} en .ics`}
              onPress={() => window.location.assign(`/api/v1/parent/children/${encodeURIComponent(child.id)}/agenda/${encodeURIComponent(event.id)}/ical`)} />
          )}
        </AgendaEvent>
      ))}
      {nextCursor && <Button label="Afficher la suite" onPress={onMore} busy={busy} secondary />}
    </View>
  );
}

const agendaStyles = StyleSheet.create({
  heading: { color: '#132d25', fontSize: 18, fontWeight: '700' },
  scope: { color: '#39584a', fontSize: 14, fontWeight: '700' },
  event: { backgroundColor: '#eef1e9', borderRadius: 12, padding: 16, gap: 8 },
});
