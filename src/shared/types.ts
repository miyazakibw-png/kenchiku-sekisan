import type {
  BasicMasterKind,
  BasicMasterRow,
} from "../core/masters/basicMaster";
import type {
  FormworkSourceGroup,
  FormworkTransferRow,
  FormworkTransferRule,
} from "../core/aggregate/formworkTransfer";

export type { BasicMasterKind, BasicMasterRow };
export type { FormworkSourceGroup, FormworkTransferRow, FormworkTransferRule };

export interface Subject {
  id: number;
  code: string;
  name: string;
  displayOrder: number;
  /** 集計時に部位Ⅱの仕分けを行わない科目（1で不要） */
  skipPart2: number;
  /** 集計順 1:部位順 2:明細番号順 */
  aggregateOrder: number;
  note: string;
  /** 将来の項目追加用の予備列 */
  spare1: string;
  spare2: string;
}

/** 工種科目マスター画面の1行。id が null の行は新規追加 */
export interface SubjectDraft {
  id: number | null;
  name: string;
  skipPart2: number;
  aggregateOrder: number;
  note: string;
  spare1: string;
  spare2: string;
}

export interface SaveSubjectsResult {
  subjects: Subject[];
  /** 明細が登録済みで削除できなかった科目名 */
  blockedDeletes: string[];
}

/** 建具表の1行 */
export interface Fitting {
  id: number;
  projectId: number;
  symbol: string;
  name: string;
  width: number | null;
  height: number | null;
  sillHeight: number | null;
  areaFormula: string;
  baseboardFormula: string;
  note: string;
  /** 1: 建具表に無いものを積算入力から登録した行 */
  fromEstimate: number;
  displayOrder: number;
}

export type FittingDraft = Omit<
  Fitting,
  "id" | "projectId" | "displayOrder"
> & {
  id: number | null;
};

export interface SaveFittingsRequest {
  projectId: number;
  rows: FittingDraft[];
}

export interface MaterialCategory {
  id: number;
  code: string;
  name: string;
  displayOrder: number;
}

export interface Unit {
  id: number;
  name: string;
  displayOrder: number;
}

/** 1明細は上下2段で構成する（上段: 部位名/摘要上段/備考上段、下段: 名称/摘要下段/備考下段） */
export interface Detail {
  id: number;
  subjectId: number;
  /** 明細番号（小数点以下2桁の数値） */
  detailNumber: number | null;
  /** 材種区分（マスタ番号で入力補助するが、マスタに無い文字も入力可） */
  materialCategory: string;
  /** 部位番号（集計書兼工事マスターから呼ぶときだけ入る） */
  partNumber?: number | null;
  partName: string;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
  estimateDisplay: string;
  displayOrder: number;
  isActive: boolean;
  /** basic: 基本マスター / project: 物件専用（工事マスター） */
  scope: string;
  projectId: number | null;
  /** 複製元の基本マスター明細（大元へ同期するときの目印） */
  sourceDetailId: number | null;
}

/** 明細マスター画面から一括保存する編集済み行 */
export interface DetailDraft {
  /** 既存行のID。新規行は null */
  id: number | null;
  detailNumber: number | null;
  materialCategory: string;
  partName: string;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
  estimateDisplay: string;
  isActive: boolean;
}

export interface SaveDetailsRequest {
  subjectId: number;
  rows: DetailDraft[];
  /** 画面上で削除された既存行のID */
  deletedIds: number[];
  /** 物件専用マスターを編集するときの物件ID（基本マスターは null） */
  projectId?: number | null;
  /** 修正履歴に残す「どの画面から直したか」 */
  origin?: string;
}

/** 物件専用マスターの明細を基本マスターへ同期した結果 */
export interface SyncDetailsResult {
  /** 大元を書き換えた件数 */
  updated: number;
  /** 大元へ新しく追加した件数 */
  added: number;
}

/** 修正履歴に残す明細の内容（修正前・修正後で同じ形） */
export interface DetailSnapshot {
  detailNumber: number | null;
  materialCategory: string;
  partName: string;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
  estimateDisplay: string;
  isActive: boolean;
}

/** 明細マスターの修正履歴1件（修正前と修正後の組） */
export interface DetailChangeLog {
  id: number;
  changedAt: string;
  scope: string;
  projectId: number | null;
  subjectId: number;
  detailId: number | null;
  /** add:追加 edit:修正 delete:削除 */
  changeKind: "add" | "edit" | "delete";
  /** どの画面から直したか */
  origin: string;
  before: DetailSnapshot | null;
  after: DetailSnapshot | null;
  /** 変わった項目（赤文字にする欄） */
  changedFields: (keyof DetailSnapshot)[];
}

export interface MasterOptions {
  subjects: Subject[];
  materialCategories: MaterialCategory[];
  units: Unit[];
  /** 型枠分類（部位別入力表の型枠欄で番号入力に使う） */
  formworkCategories: MasterEntry[];
  /** 入力拾い用の部位（計算書の下段で番号入力に使う） */
  pickupParts: MasterEntry[];
  /** 管理用の部位（計算書のセット先頭の部位欄で使う） */
  aggregationParts: MasterEntry[];
  /** 計算書の書式（将来の追加はこのマスターを増やす） */
  calcSheets: CalcSheetOption[];
}

/** 計算書の書式。key を部位別入力表の計算タイプに持つ */
export interface CalcSheetOption {
  id: number;
  key: string;
  name: string;
}

/** 番号入力で名称に変換する共通マスターの1件 */
export interface MasterEntry {
  id: number;
  name: string;
  /** マスターの備考（候補一覧に出すだけで、入力には影響しない） */
  note?: string;
}

/** 部屋ごとの計算タイプ（計算書書式の key。将来書式が増えても字面を増やすだけで済む） */
export type CalcType = string;

/** 部位別入力表（積算管理）の1行 */
export interface EstimateRow {
  id: number;
  projectId: number;
  /** room: 部屋の行 / subtotal: 小計行 */
  rowType: "room" | "subtotal";
  /** 空欄なら入力のある上の行を引き継ぐ */
  part1: string;
  part2: string;
  /** 1: 集計時に部位Ⅱ別で仕分ける */
  part2Split: number;
  formwork: string;
  /** 部位Ⅲ（部屋名） */
  part3: string;
  ceilingHeight: number | null;
  multiplier: number;
  note: string;
  calcType: CalcType;
  displayOrder: number;
}

export type EstimateRowDraft = Omit<
  EstimateRow,
  "id" | "projectId" | "displayOrder"
> & {
  id: number | null;
  /** 行コピーの元になった行のID。新しい行として保存するとき計算書の中身も複製する */
  copySourceId?: number | null;
};

export interface SaveEstimateRowsRequest {
  projectId: number;
  rows: EstimateRowDraft[];
}

/** 部屋計算書の上段（部屋形状の単線図・天井高さ） */
export interface RoomSheet {
  id: number;
  projectId: number;
  /** 部位別入力表の行（1行＝1部屋＝1計算書） */
  estimateRowId: number;
  /** 部屋形状（辺の並び）のJSON */
  shapeJson: string;
  /** 上段の自動計算に使う建具（RoomSheetFittingの配列）のJSON */
  fittingsJson: string;
  /** 天井伏図の線（CeilingElementの配列）のJSON */
  ceilingJson: string;
  /** 天井伏図のC番号を手で動かした位置（番号→ずらし量）のJSON */
  ceilingCodesJson: string;
  /** 下段のセット明細計算表 */
  lowerJson: string;
  ceilingHeight: number | null;
  note: string;
}

/**
 * 上段に書く建具。上段の自動計算（壁面積・巾木長さの差し引き）にだけ使う。
 * 下段の計算式の建具記号（<AW1> など）はここの記入に関係なく建具表から引用する。
 */
export interface RoomSheetFitting {
  /** 数量根拠の追跡用のID */
  id: string;
  symbol: string;
  /** 同じ建具の数 */
  multiplier: number;
  /** 取り付く壁の辺ID（未指定は合計からだけ差し引く） */
  edgeId: string | null;
}

export type SaveRoomSheetRequest = Omit<
  RoomSheet,
  "projectId" | "estimateRowId" | "ceilingCodesJson"
> & {
  /** 天井伏図のC番号を動かした位置（省略したときは今の位置のまま） */
  ceilingCodesJson?: string;
};

/** 軸組計算書の上段（建物レイアウト・軸組ライン） */
export interface FrameSheet {
  id: number;
  projectId: number;
  /** 部位別入力表の行（1行＝1軸組計算書） */
  estimateRowId: number;
  /** 配置した部屋（FramePlacementの配列）のJSON */
  layoutJson: string;
  /** 直接引いた軸組ライン（FrameManualLineの配列）のJSON */
  linesJson: string;
  /** 軸組ラインごとの指定（FrameLineAttribute）のJSON */
  attributesJson: string;
  /** 軸組で拾う建具のJSON */
  fittingsJson: string;
  /** 下段のセット明細計算表 */
  lowerJson: string;
  workHeight: number | null;
  note: string;
}

export type SaveFrameSheetRequest = Omit<
  FrameSheet,
  "projectId" | "estimateRowId"
>;

/** 汎用計算書（上段が無く、セット明細計算表だけで拾う計算書） */
export interface GeneralSheet {
  id: number;
  projectId: number;
  /** 部位別入力表の行（1行＝1汎用計算書） */
  estimateRowId: number;
  /** セット明細計算表 */
  lowerJson: string;
  note: string;
}

export type SaveGeneralSheetRequest = Omit<
  GeneralSheet,
  "projectId" | "estimateRowId"
>;

/**
 * 転記入力表の1行（1明細）。
 * 集計書兼工事マスターへ直接計上し、根拠集計（計算書の数量根拠）には含めない。
 */
export interface TransferRow {
  id: number;
  projectId: number;
  /** A〜G: 空欄なら入力のある上の行を引き継ぐ */
  part1: string;
  part2: string;
  /** 1: 集計時に部位Ⅱ別で仕分ける */
  part2Split: number;
  formwork: string;
  part3: string;
  /** H: 科目ID */
  subjectId: number | null;
  /** I: 仕上（材種）区分 */
  materialCategory: string;
  /** J〜N: 明細（セット明細は使わず、全て1明細入力） */
  partId: number | null;
  partName: string;
  detailNumber: number | null;
  name: string;
  /** 呼び出し元の明細レコードID */
  sourceDetailId: number | null;
  descriptionUpper: string;
  descriptionLower: string;
  quantity: number | null;
  unit: string;
  /** O・P: 将来用（単価・金額） */
  unitPrice: number | null;
  amount: number | null;
  /** Q: 備考（上段） */
  remarks: string;
  /** Q: 備考（下段。集計書と同じ2段） */
  remarksLower: string;
  /** R: メモ（どこにも連動しない） */
  memo: string;
  /** 型枠転記で作った行の生成元（型枠分類） */
  formworkKey: string;
  displayOrder: number;
}

export type TransferRowDraft = Omit<
  TransferRow,
  "id" | "projectId" | "displayOrder" | "formworkKey"
> & {
  id: number | null;
  /** 型枠転記で作った行だけ持つ（画面で作る行は空欄） */
  formworkKey?: string;
};

export interface SaveTransferRowsRequest {
  projectId: number;
  rows: TransferRowDraft[];
}

/** 軸組計算書のレイアウトに置ける部屋（部屋計算書を作った行） */
export interface FrameRoomOption {
  estimateRowId: number;
  /** 部位Ⅱ＋半角スペース＋部位Ⅲ */
  roomName: string;
  /** 部屋形状（辺の並び）のJSON */
  shapeJson: string;
  ceilingHeight: number | null;
}

/** basic: 全物件共通の基本セット / project: 積算入力時に自動登録される物件固有セット */
export type AssemblyScope = "basic" | "project";

/**
 * セットの構成明細。
 * 明細マスターを参照せず、呼び出した時点の内容を写し取って保持する（一方通行）。
 */
export interface AssemblyItem {
  id: number | null;
  /** 写し取り元の明細（追跡用。連動はしない） */
  sourceDetailId: number | null;
  subjectId: number;
  partNumber: number | null;
  detailNumber: number | null;
  materialCategory: string;
  partName: string;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
  estimateDisplay: string;
  formula: string;
  /** 掛け率（セットで拾うが計上単位が異なる場合に使用） */
  coefficient: number;
}

export interface FinishAssembly {
  id: number;
  scope: AssemblyScope;
  projectId: number | null;
  note: string;
  displayOrder: number;
  /** 1行目が一覧の表示行になる */
  items: AssemblyItem[];
}

export interface SaveAssemblyRequest {
  /** 既存セットのID。新規は null */
  id: number | null;
  scope: AssemblyScope;
  projectId: number | null;
  note: string;
  items: AssemblyItem[];
  /** マスター画面での修正のとき true。計算書のセットへ内容を連動させる */
  propagate?: boolean;
  /** 直した明細を、その明細を使っている他のセットにも反映する */
  applyToAllSets?: boolean;
}

/** 保存結果。同じ内容のセットが既にある場合は統合候補を返す */
export interface SaveAssemblyResult {
  assembly: FinishAssembly;
  /** 内容が一致する既存セット（統合確認用） */
  duplicateOf: FinishAssembly | null;
  /** 連動して直した計算書のセット数 */
  syncedSets: number;
}

export interface Part {
  id: number;
  code: string | null;
  name: string;
  displayOrder: number;
}

/** 仕上明細セット画面で使うマスター。明細マスター画面と同じ内容 */
export type AssemblyMasterOptions = MasterOptions;

/** 物件管理台帳のユーザー定義列 */
export interface ProjectField {
  id: number;
  title: string;
  /** 画面表示の桁数制限（半角換算）。入力値自体は制限しない */
  displayWidth: number;
  displayOrder: number;
}

/** 物件管理台帳の1行。工事概要と同じ内容を扱う */
export interface ProjectSummary {
  id: number;
  /** 自動採番・変更不可 */
  managementNo: string;
  /** YYYY-MM-DD */
  projectDate: string;
  name: string;
  builderName: string;
  designerName: string;
  note: string;
  displayOrder: number;
  /** ユーザー定義列の値（キーは m_project_fields.id） */
  fieldValues: Record<number, string>;
}

/** 管理番号以外を更新する（台帳・工事概要のどちらからでも同じ内容を更新する） */
export interface SaveProjectRequest {
  id: number;
  projectDate: string;
  name: string;
  builderName: string;
  designerName: string;
  note: string;
  fieldValues: Record<number, string>;
}

export interface ProjectLedger {
  projects: ProjectSummary[];
  fields: ProjectField[];
}

/** 集計を実行した回（集計書兼工事マスターの版） */
export interface AggregateRun {
  id: number;
  projectId: number;
  createdAt: string;
  note: string;
}

/** 集計書兼工事マスターの1明細（画面では上下2行） */
export interface AggregateItem {
  id: number;
  runId: number;
  displayOrder: number;
  /** 同じ明細をまとめるキー。集計をかけ直しても変わらない（型枠転記の連動に使う） */
  masterKey: string;
  part1: string;
  part2: string;
  part2Raw: string;
  subjectId: number | null;
  materialCategory: string;
  partNumber: number | null;
  partName: string;
  detailNumber: number | null;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
  estimateDisplay: string;
  formwork: string;
  /** 不要明細（人が印を付けた明細。内訳書へは飛ばさず工種科目の最後にまとめる） */
  unused: boolean;
  quantity: number;
  /** 根拠（部屋別の内訳）。転記入力表の分は入れない */
  rooms: { roomName: string; quantity: number }[];
}

/** 不要明細の印を付ける／外す */
export interface SetDetailUnusedRequest {
  projectId: number;
  masterKey: string;
  unused: boolean;
  /** 不要にした理由（設計事務所の指示など） */
  note?: string;
}

/** 集計詳細データ（合算前の1件。数量根拠） */
export interface AggregateDetail {
  id: number;
  runId: number;
  traceId: string;
  masterKey: string;
  /** room / frame / general / transfer */
  sourceKind: string;
  estimateRowId: number | null;
  transferRowId: number | null;
  part1: string;
  part2: string;
  part2Raw: string;
  part2Split: number;
  part2Order: number;
  part3: string;
  formwork: string;
  multiplier: number;
  subjectId: number | null;
  materialCategory: string;
  partNumber: number | null;
  partName: string;
  detailNumber: number | null;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
  estimateDisplay: string;
  coefficient: number;
  setTotal: number;
  quantity: number;
  sourceDetailId: number | null;
}

export interface AggregateView {
  run: AggregateRun | null;
  items: AggregateItem[];
  details: AggregateDetail[];
}

/** 集計書兼工事マスターで直した1明細（元の計算書と工事の明細マスターへ書き戻す） */
export interface AggregateItemEdit {
  masterKey: string;
  subjectId: number | null;
  materialCategory: string;
  partNumber: number | null;
  partName: string;
  detailNumber: number | null;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
}

export interface SaveAggregateEditsRequest {
  projectId: number;
  runId: number;
  edits: AggregateItemEdit[];
  /** 同じ工事用明細マスターから拾った行も、まとめて同じ内容に直す */
  applyToSameDetail?: boolean;
}

/** 部位別入力表のチェック列（管理用部位ごとの仕上名称と数量） */
export interface EstimateRowCheckCell {
  partName: string;
  name: string;
  quantity: number;
}

export interface EstimateRowCheck {
  estimateRowId: number;
  cells: EstimateRowCheckCell[];
}

/** 型枠転記で選べる元明細（最新の集計書兼工事マスターの明細） */
export interface FormworkSourceItem {
  masterKey: string;
  part1: string;
  part2: string;
  subjectId: number | null;
  materialCategory: string;
  partNumber: number | null;
  partName: string;
  detailNumber: number | null;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  quantity: number;
}

/** 型枠転記（選んだ元明細の数量→掛け率→転記入力表へ自動転記） */
export interface FormworkTransferView {
  rules: FormworkTransferRule[];
  /** 選べる元明細（集計書兼工事マスターの明細） */
  sources: FormworkSourceItem[];
  /** 元明細ごとの型枠分類別の数量 */
  groups: FormworkSourceGroup[];
  rows: FormworkTransferRow[];
}

export interface SaveFormworkRulesRequest {
  projectId: number;
  rules: FormworkTransferRule[];
}

/** 内訳書の設定（物件ごとに1件。2回目以降はこれを読み込んでから転記する） */
export interface BreakdownSettingsRecord {
  projectId: number;
  /** 1:2段1行 2:1段 3:エクセル転記用 */
  layout: number;
  /** 1:そのまま 2:部位＋半角スペース＋名称 */
  namePattern: number;
  /** half / full / raw */
  nameWidth: string;
  roundThreshold1: number;
  roundDecimals1: number;
  roundThreshold2: number;
  roundDecimals2: number;
  roundDecimals3: number;
  /** 工種科目の並び（科目ID） */
  subjectOrder: number[];
  /** 摘要の文字置き換え */
  replacements: { from: string; to: string }[];
  /** 単位の並び */
  unitOrder: string[];
  /** 単位の置き換え（変更後が空なら集計書の単位のまま） */
  unitReplacements: { from: string; to: string }[];
  /** エクセル掃き出し：1ページ目の明細数（タイトル行を含む） */
  detailsPerPage: number;
  /** エクセル掃き出し：2ページ目以降の明細数 */
  detailsPerPageLater: number;
  /** BCS・印刷で使う2層目の工事区分 */
  workCategory: string;
}

/** 内訳書の版（提出の回） */
export interface BreakdownVersion {
  id: number;
  projectId: number;
  round: number;
  createdAt: string;
  /** 1で確定（次の転記は新しい回になる） */
  confirmed: number;
  aggregateRunId: number | null;
  note: string;
}

/** 内訳書の1行 */
export interface BreakdownRowRecord {
  id: number | null;
  displayOrder: number;
  /** subject / detail / note / blank */
  rowKind: string;
  subjectId: number | null;
  subjectName: string;
  masterKey: string;
  aggregateItemId: number | null;
  partName: string;
  nameUpper: string;
  nameLower: string;
  descriptionUpper: string;
  descriptionLower: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  amount: number | null;
  remarksUpper: string;
  remarksLower: string;
}

export interface BreakdownView {
  version: BreakdownVersion | null;
  rows: BreakdownRowRecord[];
  settings: BreakdownSettingsRecord;
}

export interface SaveBreakdownRowsRequest {
  versionId: number;
  rows: BreakdownRowRecord[];
}

/** 掃き出しの種類 */
export type BreakdownExportKind = "bcs" | "excelAll" | "excelBySubject";

export interface BreakdownExportRequest {
  projectId: number;
  versionId: number;
  kind: BreakdownExportKind;
}

/** 画面の表1つ分（エクセル掃き出し用） */
export interface ScreenSheetData {
  name: string;
  rows: string[][];
}

export interface ScreenExcelRequest {
  /** 既定のファイル名（拡張子なし） */
  defaultName: string;
  sheets: ScreenSheetData[];
}

/** 印刷・PDF・エクセルの結果。取り消した場合は filePath が null */
export interface PrintResult {
  filePath: string | null;
}

/** 印刷・PDFの用紙（大きさと向き） */
export interface PrintPaper {
  pageSize: "A4" | "A3";
  landscape: boolean;
}

/** 積算データ（バックアップ／復元）の状態 */
export interface BackupInfo {
  /** 積算データの保存場所 */
  databasePath: string;
  /** データの大きさ（バイト） */
  size: number;
  /** 工事件数 */
  projectCount: number;
}

/** データ保存・復元の結果 */
export interface BackupResult {
  /** 取り消した場合は false */
  done: boolean;
  /** 保存先／復元元のファイル */
  filePath: string | null;
  /** 画面に出す説明 */
  message: string;
}

export interface BreakdownExportResult {
  /** 保存したファイル。取り消した場合は null */
  filePath: string | null;
}

/** その他マスター（明細用部位・材種区分・単位・管理用部位・型枠分類） */
export interface BasicMasters {
  pickupParts: BasicMasterRow[];
  materialCategories: BasicMasterRow[];
  units: BasicMasterRow[];
  aggregationParts: BasicMasterRow[];
  formworkCategories: BasicMasterRow[];
}

export interface SaveBasicMasterRequest {
  kind: BasicMasterKind;
  rows: BasicMasterRow[];
  /** 工事専用マスターを直すときの工事ID（基本マスターは省略） */
  projectId?: number | null;
}

export interface SaveBasicMasterResult {
  masters: BasicMasters;
  /** 番号・名称の不備。1件でもあれば保存しない */
  errors: string[];
}
