# Supabase（DB/Edge Functions）

このフォルダは **Web-to-Book Reader** の Supabase 側（Postgresスキーマ / Edge Functions）を管理します。

## DB（マイグレーション）
- `supabase/migrations/0001_init.sql`
  - テーブル: `profiles`, `articles`, `reading_progress`, `collections`, `article_collections`
  - RLS: 全テーブル有効
  - `articles.url_hash` 生成トリガーあり（URL重複の判定用）

### 適用方法（例）
Supabase CLI を使う場合：

```bash
supabase start
supabase db reset
```

※ 既存プロジェクトに適用する場合は、SQL Editor で `0001_init.sql` を順に実行してもOKです。

## Edge Functions
- `supabase/functions/extract-article/index.ts`
  - URLを取得し、Readabilityで本文抽出 → `articles` を更新
  - SSRF/サイズ/タイムアウト等の最低限の安全対策を含む（MVP想定）

