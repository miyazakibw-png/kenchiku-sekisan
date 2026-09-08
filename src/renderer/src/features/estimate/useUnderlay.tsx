import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type PointerEvent,
  type SetStateAction,
} from "react";
import {
  EMPTY_UNDERLAY,
  scaleUnderlay,
  type TraceUnderlay,
} from "../../../../core/room/trace";
import { pdfPageImage } from "./pdfPage";
import { ask } from "../common/askDialog";
import "./underlay.css";

/**
 * 計算書の図（平面図）に図面を下敷きとして置く仕組み。
 * 貼る・ファイルから読む・縮尺合わせ・戻す・動かす・濃さ・外す をまとめて持ち、
 * ピット計算書・部屋計算書の図で同じ動きになるようにする。
 */

export type UnderlayMode = "off" | "scale" | "move";

export interface Point {
  x: number;
  y: number;
}

export interface UnderlayBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 画面の座標を svg の座標（図の座標m）にする */
export function svgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): Point {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const origin = svg.createSVGPoint();
  origin.x = clientX;
  origin.y = clientY;
  const point = origin.matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

interface Options {
  /** 画面下の案内文を出す */
  setMessage: (text: string) => void;
  /** 貼った直後の仮の縮尺を決めるための、図のいまの大きさ（m）。0なら10mとみなす */
  planSize: number;
  /**
   * 下敷きを置き替える操作（貼る・縮尺合わせ・縮尺を戻す・外す）の直前に呼ぶ。
   * 計算書側で戻る用の履歴に積み、図形を図面に付いていかせるときに渡す（下敷き自体はこのフックが置き替える）
   */
  commit?: (before: TraceUnderlay, after: TraceUnderlay) => void;
  /** 図面を動かし始めた（戻る用に動かす前を覚える） */
  dragStart?: (before: TraceUnderlay) => void;
  /** 図面を動かしている途中（from＝動かし始めの下敷き、to＝いまの下敷き）。図形を一緒に動かすときに渡す */
  drag?: (from: TraceUnderlay, to: TraceUnderlay) => void;
}

export interface Underlay {
  underlay: TraceUnderlay;
  setUnderlay: Dispatch<SetStateAction<TraceUnderlay>>;
  /** 画像を置く範囲（m）。図面が無い・縮尺が無いときは null */
  box: UnderlayBox | null;
  mode: UnderlayMode;
  scalePoints: Point[];
  scaleText: string;
  setScaleText: (text: string) => void;
  pageText: string;
  setPageText: (text: string) => void;
  canUndoScale: boolean;
  pasteImage: () => Promise<void>;
  openFile: () => Promise<void>;
  applyScale: () => void;
  undoScale: () => void;
  toggleScale: () => void;
  toggleMove: () => void;
  remove: () => Promise<void>;
  /** svg の onClick から呼ぶ。下敷きの操作で使ったときは true（元の処理はしない） */
  onSvgClick: (event: MouseEvent<SVGSVGElement>) => boolean;
  onPointerDown: (event: PointerEvent<SVGSVGElement>) => void;
  onPointerMove: (event: PointerEvent<SVGSVGElement>) => void;
  onPointerUp: (event: PointerEvent<SVGSVGElement>) => void;
  /** svg に付ける class（縮尺合わせ・動かす中はカーソルを変える） */
  svgClass: string;
}

export function useUnderlay({
  setMessage,
  planSize,
  commit,
  dragStart,
  drag,
}: Options): Underlay {
  const [underlay, setUnderlay] = useState<TraceUnderlay>(EMPTY_UNDERLAY);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const [mode, setMode] = useState<UnderlayMode>("off");
  const [scalePoints, setScalePoints] = useState<Point[]>([]);
  const [scaleText, setScaleText] = useState("3.640");
  const [pageText, setPageText] = useState("1");
  const [scaleUndo, setScaleUndo] = useState<TraceUnderlay[]>([]);
  const dragRef = useRef<{
    clientX: number;
    clientY: number;
    from: TraceUnderlay;
  } | null>(null);

  const replace = useCallback(
    (before: TraceUnderlay, after: TraceUnderlay) => {
      if (commit) commit(before, after);
      setUnderlay(after);
    },
    [commit],
  );

  useEffect(() => {
    if (underlay.image === "") return;
    const image = new Image();
    image.onload = () =>
      setSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = underlay.image;
  }, [underlay.image]);

  const box = useMemo<UnderlayBox | null>(() => {
    if (underlay.image === "" || underlay.metersPerPixel <= 0) return null;
    return {
      x: underlay.x,
      y: underlay.y,
      width: size.width * underlay.metersPerPixel,
      height: size.height * underlay.metersPerPixel,
    };
  }, [size, underlay]);

  const SCALE_HINT =
    "図面の中で長さの分かる所を2回クリックし、その実寸（m）を入れて［合わせる］を押してください";

  const putImage = useCallback(
    (dataUrl: string) => {
      replace(underlay, {
        image: dataUrl,
        metersPerPixel: Math.max(planSize, 10) / 1000,
        x: 0,
        y: 0,
        opacity: 0.75,
        scaled: false,
      });
      setScalePoints([]);
      setMode("scale");
      setMessage(SCALE_HINT);
    },
    [planSize, replace, setMessage, underlay],
  );

  const pasteImage = useCallback(async () => {
    const fromApp = await window.sekisan.readClipboardImage();
    if (fromApp.image !== "") {
      putImage(fromApp.image);
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((entry) => entry.startsWith("image/"));
        if (type === undefined) continue;
        const blob = await item.getType(type);
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("画像を読めませんでした"));
          reader.readAsDataURL(blob);
        });
        putImage(dataUrl);
        return;
      }
    } catch {
      // クリップボードを読めないときは知らせるだけにする
    }
    setMessage(`クリップボードに画像がありません（中身：${fromApp.note}）`);
  }, [putImage, setMessage]);

  const openFile = useCallback(async () => {
    const page = Number(pageText);
    setMessage("ファイルを読んでいます…");
    const got = await window.sekisan.openDrawingFile(page > 0 ? page : 1);
    if (got.pdf !== "") {
      const made = await pdfPageImage(got.pdf, page > 0 ? page : 1);
      if (made.image === "") {
        setMessage("PDFを画像にできませんでした");
        return;
      }
      putImage(made.image);
      return;
    }
    if (got.image !== "") {
      putImage(got.image);
      return;
    }
    setMessage(got.note === "" ? "取り込みをやめました" : got.note);
  }, [pageText, putImage, setMessage]);

  const applyScale = useCallback(() => {
    const meters = Number(scaleText);
    if (!Number.isFinite(meters) || meters <= 0) {
      setMessage("実寸（m）を入れてください");
      return;
    }
    if (scalePoints.length < 2) {
      setMessage("図面の上で長さの分かる所を2点クリックしてください");
      return;
    }
    const scaled = scaleUnderlay(
      underlay,
      scalePoints[0],
      scalePoints[1],
      meters,
    );
    if (scaled === null) {
      setMessage("2点が近すぎます。離れた2点をクリックしてください");
      return;
    }
    setScaleUndo((current) => [...current.slice(-9), underlay]);
    replace(underlay, scaled);
    setScalePoints([]);
    setMode("off");
    setMessage(
      commit
        ? "縮尺を合わせました（なぞったピットも図面に合わせて伸び縮みしています。［↶ 戻る］で元に戻せます）"
        : "縮尺を合わせました（図形はそのままです）",
    );
  }, [commit, replace, scalePoints, scaleText, setMessage, underlay]);

  const undoScale = useCallback(() => {
    const last = scaleUndo[scaleUndo.length - 1];
    if (last === undefined) return;
    replace(underlay, last);
    setScaleUndo(scaleUndo.slice(0, -1));
    setMessage("縮尺合わせを元に戻しました");
  }, [replace, scaleUndo, setMessage, underlay]);

  const toggleScale = useCallback(() => {
    setScalePoints([]);
    const next = mode === "scale" ? "off" : "scale";
    setMode(next);
    setMessage(next === "scale" ? SCALE_HINT : "縮尺合わせをやめました");
  }, [mode, setMessage]);

  const toggleMove = useCallback(() => {
    setScalePoints([]);
    const next = mode === "move" ? "off" : "move";
    setMode(next);
    setMessage(
      next === "move"
        ? "図面をつまんで動かしてください（終わったらもう一度［図面を動かす］）"
        : "図面を動かすのをやめました",
    );
  }, [mode, setMessage]);

  const remove = useCallback(async () => {
    if (!(await ask("下敷きの図面を外します。よろしいですか"))) return;
    replace(underlay, EMPTY_UNDERLAY);
    setMode("off");
    setScalePoints([]);
    setScaleUndo([]);
    setMessage("下敷きの図面を外しました");
  }, [replace, setMessage, underlay]);

  const onSvgClick = useCallback(
    (event: MouseEvent<SVGSVGElement>): boolean => {
      if (mode === "off") return false;
      if (mode === "scale") {
        const at = svgPoint(event.currentTarget, event.clientX, event.clientY);
        setScalePoints((current) =>
          current.length >= 2 ? [at] : [...current, at],
        );
      }
      return true;
    },
    [mode],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (mode !== "move") return;
      dragRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        from: underlay,
      };
      if (dragStart) dragStart(underlay);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [dragStart, mode, underlay],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      const start = dragRef.current;
      if (start === null) return;
      const svg = event.currentTarget;
      const from = svgPoint(svg, start.clientX, start.clientY);
      const to = svgPoint(svg, event.clientX, event.clientY);
      const moved: TraceUnderlay = {
        ...start.from,
        x: start.from.x + (to.x - from.x),
        y: start.from.y + (to.y - from.y),
      };
      if (drag) drag(start.from, moved);
      setUnderlay(moved);
    },
    [drag],
  );

  const onPointerUp = useCallback((event: PointerEvent<SVGSVGElement>) => {
    if (dragRef.current === null) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return {
    underlay,
    setUnderlay,
    box,
    mode,
    scalePoints,
    scaleText,
    setScaleText,
    pageText,
    setPageText,
    canUndoScale: scaleUndo.length > 0,
    pasteImage,
    openFile,
    applyScale,
    undoScale,
    toggleScale,
    toggleMove,
    remove,
    onSvgClick,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    svgClass: mode === "off" ? "" : `underlay-${mode}`,
  };
}

/** 図の表示範囲（左上と大きさ）に下敷きの範囲を足す */
export function unionBox(
  base: UnderlayBox,
  extra: UnderlayBox | null,
): UnderlayBox {
  if (extra === null) return base;
  const left = Math.min(base.x, extra.x - 0.5);
  const top = Math.min(base.y, extra.y - 0.5);
  const right = Math.max(base.x + base.width, extra.x + extra.width + 0.5);
  const bottom = Math.max(base.y + base.height, extra.y + extra.height + 0.5);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 図面取り込みのボタン列（図面を貼る／図面ファイル／縮尺合わせ／戻す／動かす／濃さ／外す） */
export function UnderlayTools({ u }: { u: Underlay }): JSX.Element {
  return (
    <span className="kind-pick underlay-tools">
      <button
        type="button"
        title="Shift+Windows+S で切り取った図面を、図の下敷きに貼ります（図形の位置・大きさを図面と見比べながら作れます）"
        onClick={() => void u.pasteImage()}
      >
        📋 図面を貼る
      </button>
      <button
        type="button"
        title="PDF・画像のファイルを選んで、図の下敷きに貼ります"
        onClick={() => void u.openFile()}
      >
        📄 図面ファイル
      </button>
      <label className="snap-field" title="PDFの何ページ目を使うか">
        頁
        <input
          className="num"
          value={u.pageText}
          onChange={(e) => u.setPageText(e.target.value)}
        />
      </label>
      {u.underlay.image !== "" && (
        <>
          <button
            type="button"
            className={u.mode === "scale" ? "on" : ""}
            title="図面の中で長さの分かる所を2点クリックし、実寸（m）を入れて［合わせる］を押すと縮尺が合います"
            onClick={u.toggleScale}
          >
            ⤢ 縮尺合わせ
          </button>
          {u.mode === "scale" && (
            <>
              <label
                className="snap-field"
                title="クリックした2点の間の実寸（m）"
              >
                実寸(m)
                <input
                  className="num"
                  value={u.scaleText}
                  onChange={(e) => u.setScaleText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") u.applyScale();
                  }}
                />
              </label>
              <button
                type="button"
                disabled={u.scalePoints.length < 2}
                title="2点の間の長さを実寸に合わせて、図面を伸び縮みさせます"
                onClick={u.applyScale}
              >
                ✓ 合わせる（{u.scalePoints.length}/2点）
              </button>
            </>
          )}
          {u.canUndoScale && (
            <button
              type="button"
              title="直前の縮尺合わせを元に戻します"
              onClick={u.undoScale}
            >
              ↶ 縮尺を戻す
            </button>
          )}
          <button
            type="button"
            className={u.mode === "move" ? "on" : ""}
            title="図面をつまんで動かします（なぞったピットは図面と一緒に動き、手で入れた図形は動きません）"
            onClick={u.toggleMove}
          >
            ✋ 図面を動かす
          </button>
          <label className="snap-field" title="図面の濃さ">
            濃さ
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={u.underlay.opacity}
              onChange={(e) =>
                u.setUnderlay((current) => ({
                  ...current,
                  opacity: Number(e.target.value),
                }))
              }
            />
          </label>
          <button
            type="button"
            title="下敷きの図面を外します（図形・入力はそのまま残ります）"
            onClick={() => void u.remove()}
          >
            🗑 図面を外す
          </button>
        </>
      )}
    </span>
  );
}

/** svg の中に置く下敷きの画像（いちばん下に描く） */
export function UnderlayImage({ u }: { u: Underlay }): JSX.Element | null {
  if (u.box === null) return null;
  return (
    <image
      href={u.underlay.image}
      x={u.box.x}
      y={u.box.y}
      width={u.box.width}
      height={u.box.height}
      preserveAspectRatio="none"
      opacity={u.underlay.opacity}
      className="underlay-image"
      style={{ pointerEvents: u.mode === "off" ? "none" : "auto" }}
    />
  );
}

/** 縮尺合わせで押した点と2点の間の線（svg のいちばん上に描く） */
export function UnderlayScaleMarks({
  u,
  span,
}: {
  u: Underlay;
  /** 図の表示範囲の大きさ（m）。印の大きさを決める */
  span: number;
}): JSX.Element | null {
  if (u.mode !== "scale" || u.scalePoints.length === 0) return null;
  return (
    <g className="underlay-scale-points">
      {u.scalePoints.length >= 2 && (
        <line
          x1={u.scalePoints[0].x}
          y1={u.scalePoints[0].y}
          x2={u.scalePoints[1].x}
          y2={u.scalePoints[1].y}
          strokeWidth={span / 300}
          strokeDasharray={`${span / 60} ${span / 120}`}
        />
      )}
      {u.scalePoints.map((point, index) => (
        <circle key={index} cx={point.x} cy={point.y} r={span / 120} />
      ))}
    </g>
  );
}
