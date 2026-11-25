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
      else if (error.status === 413) setProblem('Une photo dépasse 10 Mo ou le stockage de l’école est plein. Les photos déjà ajoutées sont conservées.');
      else if (error.status === 415) setProblem('Une image n’a pas pu être lue. Choisissez un fichier JPEG, PNG ou WebP statique. Les photos déjà ajoutées sont conservées.');
      else if (error.status === 422) setProblem('Vérifiez le contenu, la validation des photos et la limite de 12 photos par article.');
      else if (error.status === 503) setProblem('Le stockage des photos est indisponible sur ce serveur.');
      else if (error.status === 0) setProblem('La connexion a été interrompue. Actualisez pour vérifier l’état de l’article.');
      else setProblem('L’opération a échoué. Réessayez dans un instant.');
    } finally {
      inProgress.current = false;
      setBusy(false);
    }
  }

  return { busy, problem, run };
}

export function ArticleRow({ article, onPress, busy, staff = false, gallery }) {
  const published = Boolean(article.publishedAt);
  const date = article.publishedAt ?? article.updatedAt;
  const status = published ? 'Publié' : 'Brouillon';
  return (
    <View style={blog.row}>
      {gallery && <View style={blog.rowGallery}>{gallery}</View>}
      <Pressable accessibilityRole="button" accessibilityLabel={staff ? `${article.title}, ${status.toLowerCase()}` : article.title}
        disabled={busy} accessibilityState={{ disabled: busy }} onPress={onPress}
        style={({ pressed }) => [blog.rowLink, pressed && blog.pressed]}>
        <View style={blog.rowContent}>
          <View style={blog.metaRow}>
            <Text style={blog.date}>{displayDate(date)}</Text>
            {staff && <Text style={[blog.status, published && blog.published]}>{status}</Text>}
          </View>
          <Text style={[blog.heading, blog.wrap]}>{article.title}</Text>
          {article.excerpt ? <Text numberOfLines={2} style={[styles.body, blog.wrap]}>{article.excerpt.replace(/\s+/g, ' ')}</Text> : null}
        </View>
        <Ionicons name="chevron-forward-outline" size={19} color="#225344" accessible={false} aria-hidden />
      </Pressable>
    </View>
  );
}

export function ArticleContent({ article, gallery }) {
  return (
    <View style={blog.article}>
      {gallery}
      {article.publishedAt && <Text style={blog.date}>{displayDate(article.publishedAt)}</Text>}
      <Text accessibilityRole="header" style={[styles.title, blog.wrap]}>{article.title}</Text>
      {article.body ? <Text selectable style={[styles.body, blog.articleBody, blog.wrap]}>{article.body}</Text> : null}
    </View>
  );
}

export const blog = StyleSheet.create({
  layout: { minWidth: 0, gap: 16 },
  row: {
    borderWidth: 1, borderColor: '#d5dfd1', borderRadius: 14, backgroundColor: '#f4f6ee',
  },
  rowLink: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowGallery: { paddingHorizontal: 7, paddingTop: 7 },
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
