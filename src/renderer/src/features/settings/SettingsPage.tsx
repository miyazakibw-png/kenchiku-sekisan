import { useCallback, useEffect, useState } from "react";
import type { BackupInfo, LineStyleSettings } from "@shared/types";
import { imeAutoEnabled, setImeAutoEnabled } from "../../hooks/useImeMode";
import {
  DEFAULT_LINE_STYLES,
  applyLineStyles,
} from "../../hooks/useLineStyles";
import "./SettingsPage.css";

/** 線の形の選べる種類（エクセルの線種に合わせた言い方） */
const LINE_SHAPES: { value: string; label: string }[] = [
  { value: "solid", label: "実線" },
  { value: "dashed", label: "破線" },
  { value: "dotted", label: "点線" },
  { value: "double", label: "二重線" },
];

function sizeText(size: number): string {
  if (size < 1024) return `${size} バイト`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** 設定画面。積算データの保存（バックアップ）と復元を行う */
export default function SettingsPage(): JSX.Element {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [imeAuto, setImeAuto] = useState(imeAutoEnabled);
  const [imeReport, setImeReport] = useState("");
  /** 画面の罫線（細い線＝表のマス目、太い線＝まとまりの区切り） */
  const [lines, setLines] = useState<LineStyleSettings>(DEFAULT_LINE_STYLES);
  const [lineMessage, setLineMessage] = useState("");

  const reload = useCallback(() => {
    void window.sekisan.getBackupInfo().then(setInfo);
  }, []);

  useEffect(reload, [reload]);

  useEffect(() => {
    void window.sekisan
      .getLineStyles()
      .then((saved) => setLines(saved ?? DEFAULT_LINE_STYLES));
  }, []);

  /** 直したらすぐ画面に当てて見せる（保存もする） */
  const editLines = (next: LineStyleSettings): void => {
    setLines(next);
    applyLineStyles(next);
    void window.sekisan.saveLineStyles(next);
    setLineMessage(
      "画面の線を変えました（すべての工事・すべての画面に効きます）",
    );
  };

  const editLine = (
    key: "thin" | "thick",
    patch: Partial<LineStyleSettings["thin"]>,
  ): void => editLines({ ...lines, [key]: { ...lines[key], ...patch } });

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.sekisan.createBackup();
      setMessage(result.message);
      reload();
    } catch (error) {
      setMessage(`保存できませんでした：${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.sekisan.restoreBackup();
      setMessage(result.message);
      reload();
    } catch (error) {
      setMessage(`復元できませんでした：${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-page">
      <h2>⚙️ 設定</h2>
      <section className="settings-card">
        <h3>積算データの保存・復元</h3>
        <p className="settings-note">
          パソコンの入替えや故障に備えて、積算データ（工事・マスター・計算書のすべて）を1つのファイルに保存できます。
          ソフトを更新（上書きインストール）してもデータはそのまま使えます。
        </p>
        <table className="settings-table">
          <tbody>
            <tr>
              <th>保存場所</th>
              <td>{info?.databasePath ?? "—"}</td>
            </tr>
            <tr>
              <th>工事件数</th>
              <td>{info ? `${info.projectCount} 件` : "—"}</td>
            </tr>
            <tr>
              <th>データの大きさ</th>
              <td>{info ? sizeText(info.size) : "—"}</td>
            </tr>
          </tbody>
        </table>
        <div className="settings-buttons">
          <button
            type="button"
            className="settings-main"
            disabled={busy}
            onClick={save}
          >
            💾 データ保存（バックアップ）
          </button>
          <button
            type="button"
            className="settings-warn"
            disabled={busy}
            onClick={restore}
          >
            ♻ データ復元
          </button>
        </div>
        <p className="settings-note">
          復元は、選んだファイルの内容で今のデータを置き換えます（実行前に確認画面が出ます）。
          復元前のデータは自動で退避するので、間違えても元に戻せます。
        </p>
        {message !== "" && <p className="settings-message">{message}</p>}
      </section>
      <section className="settings-card">
        <h3>画面の線（線種・太さ・色）</h3>
        <p className="settings-note">
          表の罫線は2種類あります。「細い線」は表のマス目（部位別入力表・各計算書の下段・部位別雑・金物入力表・家具・設備入力表・チェック表）、「太い線」は計算書のセット明細の区切りです。直すとすぐ画面に反映し、すべての工事で同じ線になります。
        </p>
        <table className="settings-table">
          <thead>
            <tr>
              <th>線</th>
              <th>太さ</th>
              <th>線種</th>
              <th>色</th>
              <th>見本</th>
            </tr>
          </thead>
          <tbody>
            {(["thin", "thick"] as const).map((key) => (
              <tr key={key}>
                <th>
                  {key === "thin" ? "細い線（マス目）" : "太い線（区切り）"}
                </th>
                <td>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    step={1}
                    value={lines[key].width}
                    onChange={(e) =>
                      editLine(key, { width: Number(e.target.value) })
                    }
                  />
                  px
                </td>
                <td>
                  <select
                    value={lines[key].style}
                    onChange={(e) => editLine(key, { style: e.target.value })}
                  >
                    {LINE_SHAPES.map((shape) => (
                      <option key={shape.value} value={shape.value}>
                        {shape.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="color"
                    value={lines[key].color}
                    onChange={(e) => editLine(key, { color: e.target.value })}
                  />
                </td>
                <td>
                  <span
                    className="line-sample"
                    style={{
                      borderTop: `${lines[key].width}px ${lines[key].style} ${lines[key].color}`,
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="settings-buttons">
          <button type="button" onClick={() => editLines(DEFAULT_LINE_STYLES)}>
            ↺ もとの線に戻す
          </button>
        </div>
        {lineMessage !== "" && (
          <p className="settings-message">{lineMessage}</p>
        )}
      </section>
      <section className="settings-card">
        <h3>文字の入力</h3>
        <p className="settings-note">
          部位・区分・科目・部位ID・名称ID・単位・計算式の欄は、全角で打っても、日本語入力（ひらがな）のまま打っても、半角の英数字に直します（この動きは常に働きます）。
          部位名・名称・摘要・コメント・備考・仕上下地摘要の欄は、打った文字をそのまま入れます。日本語はキーボードの「半角/全角」で日本語入力をオンにして打ってください（スペースでの漢字変換はこれまでどおりです）。
        </p>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={imeAuto}
            onChange={(e) => {
              setImeAuto(e.target.checked);
              setImeAutoEnabled(e.target.checked);
            }}
          />
          欄に入ったとき、日本語入力を自動で切り替える（部位名・名称・摘要などはひらがな、ID・計算式などは半角英数）
        </label>
        <div className="settings-buttons">
          <button
            type="button"
            onClick={() => {
              void window.sekisan.setImeMode("hiragana").then(setImeReport);
            }}
          >
            あ 日本語入力の切り替えを試す（ひらがな）
          </button>
          <button
            type="button"
            onClick={() => {
              void window.sekisan.setImeMode("alphanumeric").then(setImeReport);
            }}
          >
            A 半角英数に戻す
          </button>
        </div>
        {imeReport !== "" && <p className="settings-message">{imeReport}</p>}
        <p className="settings-note">
          Windowsでのみ働きます。日本語入力の種類によっては切り替わらないことがあります。その場合はこの印を外して、「半角/全角」キーで切り替えてください。
        </p>
      </section>
    </div>
  );
}
