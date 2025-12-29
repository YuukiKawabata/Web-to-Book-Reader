# Web-to-Book Reader

## ドキュメント
- **仕様書（要件定義）**: `docs/01_spec_requirements.md`
- **設計書**: `docs/02_design_architecture.md`
- **タスク表（開発フェーズ/依存/完了条件）**: `docs/03_tasks.md`

## 実装（モバイルアプリ）
- Expoアプリ: `mobile/`
  - 環境変数: `mobile/.env.example` を参考に `.env` を作成
  - 起動: `cd mobile && npm install && npm run start`

## 実装（Supabase）
- DB/Edge Functions: `supabase/`（手順は `supabase/README.md`）