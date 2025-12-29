# Web-to-Book Reader 設計書 v0.1

本書は React Native（Expo）+ Supabase を前提にした設計ドラフトです。MVPを「軽く・壊れにくく・拡張可能」に実装するための判断基準を定義します。

## 1. 全体アーキテクチャ
### 1.1 構成
- **Client**: Expo（iOS/Android）
  - URL登録、ライブラリ閲覧、リーダーUI、ローカルキャッシュ、オフラインキュー
- **Backend**: Supabase
  - **Postgres**: 永続データ（記事、進捗、コレクション、設定）
  - **Auth**: 認証（メール/OTP/ソーシャルは要選定）
  - **Realtime**: 進捗の購読（必要に応じて）
  - **Edge Functions（Deno）**: 本文抽出（外部URL fetch + Readability + 正規化 + 保存）
- **Storage（任意）**: 画像（cover/本文画像のミラーリングは将来）

### 1.2 重い処理をEdge側へ寄せる理由
- アプリ側でDOM解析・Readabilityを走らせると端末/OS差分・メモリ負荷・待ち時間が増えるため
- Edgeで統一した抽出結果（JSON）を生成し、アプリは「描画」に集中する

## 2. データモデル（Supabase / Postgres）
### 2.1 テーブル一覧（MVP）
#### `profiles`
- **用途**: ユーザー設定・表示名など
- **主なカラム**
  - `id uuid`（PK, auth.users.id参照）
  - `username text`
  - `avatar_url text`
  - `settings jsonb`（readerテーマ等）
  - `created_at timestamptz default now()`
  - `updated_at timestamptz default now()`

#### `articles`
- **用途**: 保存された記事のメタ + 抽出済み本文
- **主なカラム**
  - `id uuid`（PK）
  - `user_id uuid`（FK → auth.users.id）
  - `url text not null`
  - `url_hash text not null`（重複判定用。`sha256(normalize(url))` 等）
  - `title text`
  - `site_name text`
  - `cover_image_url text`
  - `author text`
  - `published_at timestamptz null`
  - `excerpt text`
  - `lang text`（推定言語）
  - `content_json jsonb`（抽出結果の正規化データ。後述）
  - `content_text text`（検索用/オフライン用のプレーンテキスト）
  - `content_html text`（必要なら保持。MVPでは省略可）
  - `status text not null default 'unread'`（unread/finished/archived）
  - `extract_status text not null default 'queued'`（queued/fetching/succeeded/failed）
  - `extract_error text`（失敗理由（ユーザー向け短文））
  - `extract_debug jsonb`（開発用：HTTP status/bytes等。MVPは保存しない運用でも可）
  - `created_at timestamptz default now()`
  - `updated_at timestamptz default now()`
- **インデックス**
  - `unique (user_id, url_hash)`（同一ユーザーの重複登録を防ぐ）
  - `index (user_id, status, updated_at desc)`

#### `reading_progress`
- **用途**: 進捗（ページ単位）
- **主なカラム**
  - `user_id uuid`（FK）
  - `article_id uuid`（FK）
  - `current_page int not null default 0`
  - `total_pages int not null default 0`
  - `progress_anchor jsonb`（任意：再分割時の復元用アンカー）
  - `last_read_at timestamptz default now()`
  - `updated_at timestamptz default now()`
- **主キー**
  - `primary key (user_id, article_id)`

#### `collections`
- **用途**: ユーザーのフォルダ
- **主なカラム**
  - `id uuid`（PK）
  - `user_id uuid`（FK）
  - `name text not null`
  - `color_code text`（例 `#C084FC`）
  - `created_at timestamptz default now()`

#### `article_collections`（推奨：多対多）
- **用途**: 記事とコレクションの紐付け
- **主なカラム**
  - `article_id uuid`（FK）
  - `collection_id uuid`（FK）
  - `created_at timestamptz default now()`
- **主キー**
  - `primary key (article_id, collection_id)`

### 2.2 `content_json` の推奨スキーマ
抽出結果は「描画に必要な最小構造」を保持します。

例：
```json
{
  "title": "…",
  "byline": "…",
  "siteName": "…",
  "lang": "ja",
  "coverImage": "https://…",
  "nodes": [
    { "t": "h1", "text": "見出し" },
    { "t": "p", "text": "本文…" },
    { "t": "img", "src": "https://…", "alt": "…" },
    { "t": "blockquote", "text": "…" }
  ]
}
```

## 3. RLS（Row Level Security）方針
- 原則：**全テーブルでRLSを有効化**し、`auth.uid() = user_id` の行のみ操作可
- `profiles`: `id = auth.uid()` のみ SELECT/UPDATE
- `articles`: `user_id = auth.uid()` のみ SELECT/INSERT/UPDATE/DELETE
- `reading_progress`: `user_id = auth.uid()` のみ SELECT/UPSERT/DELETE
- `collections` / `article_collections`: `user_id`（経由）一致のみ

Edge Function は **Service Role** を使ってDB更新可能だが、入力検証とユーザー紐付けは厳格に行う（後述）。

## 4. Edge Function（本文抽出）設計
### 4.1 役割
- URLを受け取り、対象ページを取得 → Readabilityで抽出 → 正規化（JSON） → `articles` を更新

### 4.2 エンドポイント案
- `POST /functions/v1/extract-article`
  - **Auth必須**（Bearer JWT）
  - **Request**
    - `url: string`
    - `articleId?: string`（事前にarticles作成する方式なら指定）
  - **Response（同期完了型の例）**
    - `articleId: string`
    - `extractStatus: "succeeded" | "failed"`
    - `title/siteName/coverImageUrl/...`

※ 実装は「同期完了」だとタイムアウト/サイズで失敗しうるため、MVPでは次のどちらかを選ぶ：
- **方式A（推奨）**: 先に `articles` を `queued` で作成 → Functionで更新 → クライアントは `articles` の `extract_status` を監視
- **方式B**: Functionが `articles` 作成から完了までやる（簡単だが再試行・状態管理が難しい）

### 4.3 外部fetchの安全対策（必須）
- **SSRF対策**: `localhost` / `127.0.0.1` / プライベートIP / メタデータIP（`169.254.169.254` 等）を拒否
- **スキーム制限**: `http/https` のみ
- **レスポンスサイズ上限**: Content-Length + ストリーム読みで上限（例 2–5MB）を超えたら中断
- **タイムアウト**: connect/readタイムアウト（例 8–15秒）
- **リダイレクト制限**: 最大回数（例 3）
- **User-Agent**: 固定（サイト互換のため）

### 4.4 抽出の品質戦略
- Readabilityの結果が薄い/空のときは `failed` にし、ユーザーへ「このサイトは抽出できない可能性」表示
- 画像URLは相対→絶対化（base URL）
- `content_text` は `nodes` から生成して保存（検索/キャッシュに有利）

## 5. クライアント（Expo）設計
### 5.1 画面構成
- `Home (Library)`
  - フィルタ（未読/読了/アーカイブ）
  - 表示切替（カード/リスト）
  - 記事カード：タイトル/サイト/カバー/抽出状態/進捗
- `Add`
  - URL入力
  - 共有受け取りからの遷移
- `Reader`
  - ページめくり（Horizontal paging）
  - 設定（フォント/行間/テーマ）
  - 進捗の自動保存
- `Settings`
  - アカウント/テーマ/既定フォントなど

### 5.2 状態管理（案）
- **Server state**（Supabaseから取得するもの）: TanStack Query を推奨
- **Local state**（UI/読書設定）: Zustand など軽量ストア（またはReact Context）
- **オフラインキュー**: ローカルDB（例：SQLite）に pending updates を保存

### 5.3 ページネーション（最重要ロジック）
#### 基本戦略（MVP）
- `content_json.nodes` を「段落単位（p/h*/blockquote）」でテキストブロック化
- 端末の `layout（width/height）` と読書設定から **1ページ当たりの収容量** を見積もり
  - 実装選択肢：
    - **A: 測定型（推奨）**: `react-native-text` の計測（onTextLayout 等）で段落を詰め、ページを確定
    - **B: 近似型**: 文字数・行数の推定で分割（簡単だが誤差が出やすい）
- ページは `FlatList horizontal pagingEnabled` で描画

#### 進捗復元の課題と対策
- フォント変更/回転でページ数が変わる
- 対策：
  - `current_page` に加えて `progress_anchor` を保存（例：`{ nodeIndex, charOffset }`）
  - 再分割後、アンカーから近いページへ復元

### 5.4 オフラインキャッシュ（Phase 4）
#### キャッシュ対象
- `articles.content_json` / `content_text`
- ページ分割結果（端末/設定依存なのでキー設計が重要）

#### キャッシュキー案
- `article_id + layout(width,height) + theme + fontSize + lineHeight + margin` のハッシュ

#### 同期キュー
- オフライン中の進捗更新を `progress_updates`（ローカル）へ追記
- オンライン復帰でまとめてUPSERT（最後の更新を優先）

## 6. 同期・競合解決
- `reading_progress` は `updated_at`（サーバ時刻）で **last-write-wins**
- クライアントは更新時に `last_read_at` をセット
- Realtime購読（任意）：同一記事閲覧中に他端末更新が来たら「別端末で進捗が更新されました」表示してジャンプ提案

## 7. エラーハンドリング指針
- URL不正：入力時に即時エラー
- 抽出失敗：
  - `extract_status=failed`、`extract_error` に短文（例：`"ページ取得に失敗しました（403）"`）
  - 再試行ボタン（同Function再実行）
- ネットワーク不安定：オフライン表示 + キューイング

## 8. セキュリティ・コンプライアンス注意
- 保存するコンテンツは第三者著作物の可能性があるため、共有/エクスポート機能はMVPから除外推奨
- サイト側の規約/robots/有料記事などは抽出失敗・制限が起きうる（アプリ内で説明）

