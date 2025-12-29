import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, FlatList, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Text } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';

type ArticleRow = {
  id: string;
  url: string;
  title: string | null;
  site_name: string | null;
  content_text: string | null;
  extract_status: string;
};

type ProgressRow = {
  current_page: number;
  total_pages: number;
};

function chunkText(text: string, approxCharsPerPage: number) {
  const pages: string[] = [];
  let i = 0;
  while (i < text.length) {
    pages.push(text.slice(i, i + approxCharsPerPage));
    i += approxCharsPerPage;
  }
  return pages.length ? pages : [''];
}

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();

  const [article, setArticle] = useState<ArticleRow | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const userId = session?.user.id;
  const listRef = useRef<FlatList<string>>(null);

  const approxCharsPerPage = useMemo(() => {
    // MVPの近似分割：画面面積に合わせて適当に調整
    const { width, height } = Dimensions.get('window');
    const area = width * height;
    // ざっくり：面積が大きいほど1ページ文字数を増やす
    return Math.max(700, Math.min(1600, Math.floor(area / 500)));
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!id) return;
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('articles')
          .select('id,url,title,site_name,content_text,extract_status')
          .eq('id', id)
          .single();
        if (error) throw error;
        if (!mounted) return;

        const a = data as ArticleRow;
        setArticle(a);

        const text = (a.content_text ?? '').trim();
        const nextPages = text ? chunkText(text, approxCharsPerPage) : [];
        setPages(nextPages);

        if (userId) {
          const p = await supabase
            .from('reading_progress')
            .select('current_page,total_pages')
            .eq('article_id', a.id)
            .eq('user_id', userId)
            .maybeSingle();

          if (p.error) {
            // 進捗テーブル未作成などはMVP中に起こりうるので致命にしない
          } else if (p.data?.current_page != null) {
            const cp = Math.max(0, p.data.current_page);
            setCurrentPage(cp);
            // 初回描画後にジャンプ
            setTimeout(() => listRef.current?.scrollToIndex({ index: cp, animated: false }), 0);
          }
        }
      } catch (e: any) {
        Alert.alert('読み込み失敗', e?.message ?? '不明なエラー');
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [approxCharsPerPage, id, userId]);

  async function saveProgress(nextPage: number, total: number) {
    if (!userId || !article) return;
    await supabase.from('reading_progress').upsert({
      user_id: userId,
      article_id: article.id,
      current_page: nextPage,
      total_pages: total,
      last_read_at: new Date().toISOString(),
    });
  }

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text>読み込み中…</Text>
      </View>
    );
  }

  if (!article) {
    return (
      <View style={styles.container}>
        <Text>記事が見つかりません。</Text>
      </View>
    );
  }

  const hasPages = pages.length > 0;

  if (!hasPages) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{article.title ?? '（タイトル不明）'}</Text>
        <Text style={styles.meta}>
          {article.site_name ?? '（サイト不明）'} / {article.extract_status}
        </Text>
        <Text style={styles.empty}>
          まだ本文がありません（抽出未実装/未完了）。Phase 2 のEdge Functionで `content_text` を生成するとここに表示されます。
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.meta}>
        {article.title ?? article.url}（{currentPage + 1}/{pages.length}）
      </Text>

      <FlatList
        ref={listRef}
        data={pages}
        horizontal
        pagingEnabled
        keyExtractor={(_, idx) => String(idx)}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          const width = e.nativeEvent.layoutMeasurement.width;
          const next = Math.round(x / Math.max(1, width));
          setCurrentPage(next);
          saveProgress(next, pages.length).catch(() => {
            // 非致命
          });
        }}
        renderItem={({ item }) => (
          <View style={styles.page}>
            <Text style={styles.pageText}>{item}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  meta: { opacity: 0.7 },
  empty: { marginTop: 12, lineHeight: 22 },
  page: {
    width: Dimensions.get('window').width - 32,
    paddingVertical: 8,
  },
  pageText: { fontSize: 16, lineHeight: 26 },
});

