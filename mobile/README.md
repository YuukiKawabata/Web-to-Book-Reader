# Mobile（Expo）

## セットアップ
1. `mobile/.env.example` を参考に `mobile/.env` を作成
2. 依存関係をインストール

```bash
cd mobile
npm install
```

## 起動

```bash
npm run start
```

## いま入っている実装（MVPの土台）
- 認証（メール+パスワード）
- 本棚（`articles` 一覧）
- URL追加（`articles` へ保存。Edge Functionがあれば抽出開始）
- Reader（`content_text` がある場合、横スワイプの簡易ページめくり + 進捗保存）
- 設定（ログアウト）

