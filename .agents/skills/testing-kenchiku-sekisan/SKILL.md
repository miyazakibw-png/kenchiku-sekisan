---
name: testing-kenchiku-sekisan
description: 建築積算システム（Electron + React + better-sqlite3）を GUI で E2E テストする手順。起動方法、DB の直接確認、既知の落とし穴。
---

# 建築積算システム GUI テスト手順

## 起動
```bash
cd /home/ubuntu/repos/kenchiku-sekisan
npm install
npm run rebuild:electron        # Electron 実行前に必須（better-sqlite3 の ABI）
                                # Vitest を回す場合は npm run rebuild:node（排他）
DISPLAY=:0 setsid nohup npx electron-vite preview > /tmp/app.log 2>&1 < /dev/null & disown
```
- `&` + `nohup` だけだと exec ツールのシェル終了時に一緒に殺されることがある。**必ず `setsid` を付ける**。
- 起動完了まで 30〜40 秒。`DISPLAY=:0 wmctrl -l` に「建築積算システム」が出るまで待つ。
- 二重起動しやすい。テスト前に `pgrep -af "dist/electron \."` で確認し、余分な PID を `kill -9`（`pkill -f` は効かない場合あり）。
- 最大化: `DISPLAY=:0 wmctrl -a "建築積算システム" && DISPLAY=:0 wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`

## データの裏取り
DB は `~/.config/kenchiku-sekisan/sekisan.db`（アプリ名の日本語ディレクトリではない）。
```bash
python3 -c "import sqlite3;c=sqlite3.connect('/home/ubuntu/.config/kenchiku-sekisan/sekisan.db');print(list(c.execute('select id,subject_id,display_order,name from m_details order by subject_id,display_order')))"
```
UI 表示だけでなく DB 側でも `display_order` と保存内容を確認すると、保存漏れ・並び順バグを確実に検出できる。

## 日本語入力
xdotool の `type` では CJK が入らない。xclip / xsel / tkinter も未導入のことがある。
回避策: 日本語を含む datalist（単位: 式・箇所・人工 など）や select（材種区分）から**選択**して日本語の保存・再表示を検証する。任意文字列が必要なら xclip をインストールしてクリップボード経由で貼り付ける。

## 既知の注意点（回帰確認ポイント）
- 明細マスターの自動保存は 15 秒間隔＋アンマウント時。**科目切替はアンマウントされないため未保存分が消える可能性がある**（PR #1 時点でバグとして確認）。テストでは必ず「未保存のまま科目切替 → 戻る」を実施すること。
- 保存ステータスが「✔ 保存済み」でも実際に DB に入っているとは限らないので、重要ケースは DB で確認する。

## Devin Secrets Needed
なし（完全オフラインアプリ）。
