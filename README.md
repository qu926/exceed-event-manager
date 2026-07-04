# EXCEED 勤怠・予約管理

`.EXE PRODUCE` の `EXCEED` 向けに、勤怠、未入力者、長期休暇、営業日、予約受付、予約枠を管理する静的SPAです。

このテンプレートには、実運用のメンバー、パスワード、Supabase 接続情報、保存データを含めていません。

## 起動

依存パッケージのインストールは不要です。

```powershell
cd D:\Ai\tool\exceed-event-manager
npm.cmd start
```

ブラウザで `http://localhost:4173/` を開きます。

## 検証

```powershell
npm.cmd test
npm.cmd run check
```

`test` はコアロジックのテスト、`check` は設定・アプリ・サーバーの構文検証を実行します。

## EXCEED設定

主要設定は `js/config.js` に集約しています。

- `appId`: イベントごとに一意な英数字とハイフン。ブラウザ保存領域の識別子にも使われます。
- `producerName` / `producerLogoPath`: .EXE PRODUCE の運営ブランド表示。
- `brandName` / `title` / `logoPath`: 既定店舗（EXCEED）の表示設定。
- `stores`: `EXCEED`、`SYNDICATE`、`THE CENTRAL` の店舗別設定。各店舗の `appId`、`stateRowId`、ロゴ、店舗パスワード、初期ユーザーを分けます。
- `groupStores`: 系列店舗名の一覧。
- `storageMode`: `"local"` または `"supabase"`。
- `supabaseUrl` / `supabaseAnonKey`: Supabase の接続設定。
- `stores[].sitePassword`: 店舗別の簡易ロック用パスワード。既定では `EXCEED`、`SYNDICATE`、`CENTRAL` です。
- `core.adminPassword`: 共通の運営パスワード。公開前に必ず変更します。
- `core.initialUsers`: 初回起動時に登録するメンバー。不要なサンプルは削除します。
- `core.initialRoles`: 初期ロール。
- `core.eventWeekdays`: 営業曜日。JavaScript の曜日番号で、木曜は `4`。
- `core.reservationOpenWeekday` / `core.reservationOpenTime`: 予約解放曜日と時刻。
- `core.firstWeekHolidayCandidates`: 各月の最初の開催日を休み候補にするか。
- `core.grandOpenDate`: グランドオープン日。EXCEED は `2026-07-09`。
- `core.preOpenEventNote` / `core.grandOpenEventNote`: グランドオープン前後の日程メモ。
- `core.eventDates`: 確定済みの開催日。設定した場合は週次自動生成より優先します。

EXCEEDの営業条件は次の通りです。

- 練習会&集団面談: 2026-06-11、2026-06-18、2026-06-25
- グランドオープン: 2026-07-09
- 営業日: 2026-07-16、2026-07-23、2026-07-30
- 予約希望回: `前半`、`後半`、`オーラス`
- 営業構成: 1インスタンス固定。運営画面で1日の受付上限を設定します。

現在の保存IDは店舗ごとに分かれています。EXCEED は `exceed-event-manager`、SYNDICATE は `syndicate-event-manager`、THE CENTRAL は `central-event-manager` です。別イベントへ複製するときは `stores[].appId` と `stores[].stateRowId` を必ず変更してください。

## GitHub Pages

GitHubリポジトリ名は `exceed-event-manager` を使用します。公開URLは次です。

```text
https://qu926.github.io/exceed-event-manager/
```

静的公開に必要なファイルは `index.html`、`assets/`、`css/`、`js/` です。

## データ保存

現在の `storageMode: "supabase"` では Supabase の `app_state` に同期します。端末やブラウザをまたいで同じ状態を共有できます。

1. Supabase でプロジェクトを作成します。
2. `supabase/schema.sql` 内の3つの ID が、`js/config.js` の `stores[].stateRowId` と一致していることを確認します。
3. SQL Editor でスキーマを実行します。
4. `js/config.js` の `storageMode` が `"supabase"` で、Project URL と publishable key または anon public key が設定されていることを確認します。

```js
storageMode: "supabase",
supabaseUrl: "https://cdnbkbryksrhioajgorg.supabase.co",
supabaseAnonKey: "sb_publishable_d-ydLZw9k8vNPpDnu_QDGA_ACjkGL_i",
stores: [
  { key: "exceed", stateRowId: "exceed-event-manager" },
  { key: "syndicate", stateRowId: "syndicate-event-manager" },
  { key: "central", stateRowId: "central-event-manager" },
],
```

店舗ごとの `stateRowId` と SQL 内の ID が一致しない場合、読み書きできません。異なる店舗やイベントで同じ `stateRowId` を使うとデータが混在するため、必ず分けてください。

## 主な機能

- メンバーと内勤スタッフの勤怠入力
- 未入力者、長期休暇、開催日、休み日の管理
- 予約受付、予約枠、1日の受付上限の管理
- 勤怠との照合警告
- Discord 文面生成
- JSON バックアップ表示
- 変更履歴

## 運用上の注意

- 画面内パスワードは静的サイト上の簡易ロックであり、本格的な認証ではありません。
- Supabase の公開キーと単純な RLS を使う構成は小規模運用向けです。機密情報は保存しないでください。
- 本番開始前に JSON を書き出すバックアップ手順を決めてください。
- 複数端末の同時更新はマージされますが、同じ項目を同時編集した場合は後の更新が優先されます。
