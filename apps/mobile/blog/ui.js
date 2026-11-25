import React, { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { styles } from '../parent/ui';

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long', timeZone: 'Europe/Paris',
});

function displayDate(value) {
  return dateFormatter.format(new Date(value));
}

export function useBlogTask(onExpired) {
  const inProgress = useRef(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function run(action) {
    if (inProgress.current) return;
    inProgress.current = true;
    setBusy(true);
    setProblem('');
    try {
      await action();
    } catch (error) {
      if (error.status === 401) onExpired();
      else if (error.status === 400) setProblem('Vérifiez le titre, le texte et leur longueur.');
      else if (error.status === 404) setProblem('Cet article ou cette classe n’est plus accessible.');
      else if (error.status === 409) setProblem('L’article a changé. Rechargez sa version enregistrée avant de continuer.');
      else if (error.status === 0) setProblem('La connexion a été interrompue. Actualisez pour vérifier l’état de l’article.');
      else setProblem('L’opération a échoué. Réessayez dans un instant.');
    } finally {
      inProgress.current = false;
      setBusy(false);
    }
  }

  return { busy, problem, run };
}

export function ArticleRow({ article, onPress, busy, staff = false }) {
  const published = Boolean(article.publishedAt);
  const date = article.publishedAt ?? article.updatedAt;
  const status = published ? 'Publié' : 'Brouillon';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={staff ? `${article.title}, ${status.toLowerCase()}` : article.title}
      disabled={busy} accessibilityState={{ disabled: busy }} onPress={onPress}
      style={({ pressed }) => [blog.row, pressed && blog.pressed]}>
      <View style={blog.rowContent}>
        <View style={blog.metaRow}>
          <Text style={blog.date}>{displayDate(date)}</Text>
          {staff && <Text style={[blog.status, published && blog.published]}>{status}</Text>}
        </View>
        <Text style={[blog.heading, blog.wrap]}>{article.title}</Text>
        <Text numberOfLines={2} style={[styles.body, blog.wrap]}>{article.excerpt.replace(/\s+/g, ' ')}</Text>
      </View>
      <Ionicons name="chevron-forward-outline" size={19} color="#225344" accessible={false} aria-hidden />
    </Pressable>
  );
}

export function ArticleContent({ article }) {
  return (
    <View style={blog.article}>
      {article.publishedAt && <Text style={blog.date}>{displayDate(article.publishedAt)}</Text>}
      <Text accessibilityRole="header" style={[styles.title, blog.wrap]}>{article.title}</Text>
      <Text selectable style={[styles.body, blog.articleBody, blog.wrap]}>{article.body}</Text>
    </View>
  );
}

export const blog = StyleSheet.create({
  layout: { minWidth: 0, gap: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16,
    borderWidth: 1, borderColor: '#d5dfd1', borderRadius: 14, backgroundColor: '#f4f6ee',
  },
  rowContent: { flex: 1, minWidth: 0, gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  date: { color: '#43584c', fontSize: 14, fontWeight: '600' },
  status: {
    backgroundColor: '#f9eccf', color: '#4a350c', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3, fontSize: 13, fontWeight: '700',
  },
  published: { backgroundColor: '#dcebd9', color: '#17372d' },
  heading: { fontSize: 20, color: '#17372d', fontWeight: '700' },
  wrap: { ...Platform.select({ web: { overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' } }) },
  article: { padding: 16, gap: 12, borderRadius: 14, backgroundColor: '#f5f6ee' },
  articleBody: { lineHeight: 26 },
  editor: { minHeight: 180, textAlignVertical: 'top' },
  pressed: { opacity: 0.7 },
  empty: { backgroundColor: '#f0f4eb', padding: 18, borderRadius: 14, gap: 8 },
});
