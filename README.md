# 建築積算システム

完全オフライン動作の建築積算デスクトップアプリ（Electron + React + SQLite）。

直すときの決まり（積算のルール・作業の流れ・報告の書き方）は [AGENTS.md](AGENTS.md) に書いてあります。AI・開発者は最初に読んでください。

## Windowsインストーラの作り方

```bash
npm run package:win
```

`dist/建築積算システム_セットアップ_<版>.exe` ができます（ダブルクリック→次へ→完了、デスクトップにアイコン、上書きインストールでも積算データは残ります）。

- Linux上で作る場合は wine（wine64 と wine32）が必要です。
- 作成時に better-sqlite3 のWindows用バイナリへ差し替わるため、作成後に開発を続けるときは `npm run rebuild:electron`（アプリ起動用）または `npm run rebuild:node`（テスト用）を実行してください。
