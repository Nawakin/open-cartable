import React, { useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useScrollToTop } from '../navigation';
import { Button, styles } from '../parent/ui';
import { ArticleContent, ArticleRow, blog, useBlogTask } from './ui';
import { GalleryPreview, PhotoCarousel } from './gallery';

export function ParentBlog({ child, request, onBack, onExpired }) {
  const path = '/children/' + encodeURIComponent(child.id) + '/blog';
  const [page, setPage] = useState(null);
  const [articleId, setArticleId] = useState(null);
  const [article, setArticle] = useState(null);
  const [photoIndex, setPhotoIndex] = useState(null);
  const { busy, problem, run } = useBlogTask(onExpired);
  const scrollToTop = useScrollToTop();
  const articlePath = (id) => path + '/' + encodeURIComponent(id);

  function list(cursor) {
    void run(async () => {
      if (!cursor) setPage(null);
      const suffix = cursor ? '?cursor=' + encodeURIComponent(cursor) : '';
      const result = await request(path + suffix);
      setPage((before) => cursor ? { ...result, articles: [...before.articles, ...result.articles] } : result);
    });
  }

  function open(id, photo = null) {
    void run(async () => {
      setArticleId(id);
      setArticle(null);
      setPhotoIndex(photo);
      scrollToTop();
      const current = await request(articlePath(id));
      setArticle(current);
    });
  }

  function backToFeed() {
    setArticleId(null);
    setArticle(null);
    setPhotoIndex(null);
    scrollToTop();
    list();
  }

  useEffect(() => { list(); }, [path]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (articleId) open(articleId);
        else list();
      }
    });
    return () => subscription.remove();
  }, [path, articleId]);

  return (
    <View style={styles.panel}>
      {!articleId && <>
        <Text accessibilityRole="header" style={styles.title}>Blog de classe</Text>
        <Text style={styles.body}>{child.displayName}</Text>
      </>}
      <View style={styles.actions}>
        <Button label="Retour" accessibilityLabel={articleId ? 'Retour aux articles' : undefined} icon="arrow-back-outline"
          onPress={articleId ? backToFeed : onBack} busy={busy} secondary />
        <Button label="Actualiser" icon="refresh-outline" onPress={() => articleId ? open(articleId) : list()} busy={busy} secondary />
      </View>
      {problem ? <Text accessibilityRole="alert" style={styles.error}>{problem}</Text> : null}
      {busy && <Text accessibilityLiveRegion="polite" style={styles.body}>Chargement…</Text>}
      {articleId ? (
        article && <ArticleContent article={article} gallery={article.photoCount > 0 && <GalleryPreview article={article}
          articlePath={articlePath(articleId)} role="parent" request={request} onOpen={setPhotoIndex} busy={busy} />} />
      ) : (
        <>
          {page?.articles.length === 0 && <View style={blog.empty}>
            <Ionicons name="newspaper-outline" size={30} color="#225344" accessible={false} aria-hidden />
            <Text style={blog.heading}>Aucun article pour le moment</Text>
            <Text style={styles.body}>Les nouvelles de la classe s’afficheront ici.</Text>
          </View>}
          {page?.articles.map((entry) => <ArticleRow key={entry.id} article={entry} onPress={() => open(entry.id)} busy={busy}
            gallery={entry.photoCount > 0 && <GalleryPreview article={entry} articlePath={articlePath(entry.id)}
              role="parent" request={request} onOpen={(index) => open(entry.id, index)} busy={busy} />} />)}
          {page?.nextCursor && <Button label="Articles précédents" onPress={() => list(page.nextCursor)} busy={busy} secondary />}
        </>
      )}
      <PhotoCarousel article={article} articlePath={articlePath(articleId ?? '')} index={photoIndex}
        role="parent" request={request} onChange={setPhotoIndex} onClose={() => setPhotoIndex(null)} />
    </View>
  );
}
