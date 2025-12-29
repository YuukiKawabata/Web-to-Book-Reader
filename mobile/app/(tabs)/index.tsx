import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { Text } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';

type ArticleRow = {
  id: string;
  url: string;
  title: string | null;
  site_name: string | null;
  status: 'unread' | 'finished' | 'archived' | string;
  extract_status: 'queued' | 'fetching' | 'succeeded' | 'failed' | string;
  created_at: string;
  updated_at: string;
};

export default function LibraryScreen() {
  const { session } = useSession();
  const [items, setItems] = useState<ArticleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const userId = session?.user.id;

  const title = useMemo(() => `本棚（${items.length}）`, [items.length]);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('articles')
      .select('id,url,title,site_name,status,extract_status,created_at,updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    setItems((data ?? []) as ArticleRow[]);
  }, [userId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!userId) return;
      setIsLoading(true);
      try {
        await load();
      } catch (e: any) {
        if (!mounted) return;
        Alert.alert('取得失敗', e?.message ?? '不明なエラー');
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [load, userId]);

  useFocusEffect(
    useCallback(() => {
      // タブに戻ったタイミングで最新化
      load().catch(() => {
        // 非致命
      });
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await load();
    } catch (e: any) {
      Alert.alert('更新失敗', e?.message ?? '不明なエラー');
    } finally {
      setIsRefreshing(false);
    }
  }, [load]);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>{title}</Text>

      <FlatList
        data={items}
        keyExtractor={(x) => x.id}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        contentContainerStyle={items.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          isLoading ? (
            <Text>読み込み中…</Text>
          ) : (
            <Text>まだ記事がありません。「追加」からURLを保存してください。</Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push(`/reader/${item.id}`)}
            android_ripple={{ color: '#00000010' }}>
            <Text style={styles.cardTitle}>{item.title ?? item.url}</Text>
            <Text style={styles.cardMeta}>
              {item.site_name ?? '（サイト不明）'} / {item.status} / {item.extract_status}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  header: { fontSize: 20, fontWeight: '700' },
  card: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0000001a',
    marginBottom: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardMeta: { marginTop: 6, opacity: 0.7 },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
});
