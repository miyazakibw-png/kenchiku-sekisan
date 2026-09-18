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

/** 図面を動かす中でも、この距離（px）未満のクリックは線・角の選択として扱う */
const DRAG_START_PX = 4;

export interface Point {
  x: number;
  y: number;
}

/**
 * 2枚目以降の図面を置く場所。今ある図面の右横に並べる（上に重ねると前の図面が隠れて見えないため）
 * 置いてある図面が無いときは {x:0, y:0}
 */
export function spotBesideBoxes(boxes: (UnderlayBox | null)[]): {
  x: number;
  y: number;
} {
  const drawn = boxes.filter((box): box is UnderlayBox => box !== null);
  if (drawn.length === 0) return { x: 0, y: 0 };
  return {
    x: Math.max(...drawn.map((box) => box.x + box.width)) + 0.5,
    y: Math.min(...drawn.map((box) => box.y)),
  };
}

export interface UnderlayBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 画像の大きさ（画素数）を読む。読めないときは null */
function loadImageSize(
  dataUrl: string,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
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
  /**
   * 下敷きを2枚以上置けるようにする（大きい部屋で図面が複数枚になるとき）。
   * true のとき貼る・開くは追加になり、選んだ1枚（active）を動かす・合わせる・外す。
   * 指定しないときは今までどおり1枚だけ（貼る・開くは置き替え）
   */
  multi?: boolean;
}

export interface Underlay {
  /** いま選んでいる図面（無ければ空）。操作ボタンは全部この1枚に効く */
  underlay: TraceUnderlay;
  setUnderlay: Dispatch<SetStateAction<TraceUnderlay>>;
  /** 置いてある図面を全部（画像のあるものだけ）。複数置ける画面で使う */
  underlays: TraceUnderlay[];
  /** 置き替え用（読み込み・戻る）。画像の無いものは除いて並びをそのまま使う。何枚目を選ぶかは activeIndex（省略時は1枚目） */
  setUnderlays: (list: TraceUnderlay[], activeIndex?: number) => void;
  /** いま選んでいる図面の番号（underlays の何枚目か） */
  active: number;
  setActive: (index: number) => void;
  /** 図面が何枚置いてあるか */
  count: number;
  /** 選んでいる図面の画像を置く範囲（m）。図面が無い・縮尺が無いときは null */
  box: UnderlayBox | null;
  /** 全図面の画像を置く範囲（m）。underlays と同じ並び、無い所は null */
  boxes: (UnderlayBox | null)[];
  /** 次に足す図面を置く場所（今ある図面の右横。無いときは原点） */
  nextSpot: { x: number; y: number };
  /** 選んでいる図面をいちばん上に出す（重なっている所で見える図面を変える。複数置ける画面だけ） */
  bringFront: () => void;
  /** ONの間は「図面を動かす」で全部の図面が一緒に動く（重ね合わせたあと1枚の絵として固定する） */
  moveAll: boolean;
  /** 読み込みのときの「まとめて動かす」の状態を戻す */
  setMoveAll: (on: boolean) => void;
  toggleMoveAll: () => void;
  mode: UnderlayMode;
  scalePoints: Point[];
  scaleText: string;
  setScaleText: (text: string) => void;
  pageText: string;
  setPageText: (text: string) => void;
  canUndoScale: boolean;
  pasteImage: () => Promise<void>;
  openFile: () => Promise<void>;
  /** 図面ファイルをまとめて複数選んで置く（複数置ける画面だけ。1枚の画面は openFile と同じ動き） */
  openFiles: () => Promise<void>;
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
  multi = false,
}: Options): Underlay {
  /** 置いてある図面。画像のあるものだけ持つ */
  const [underlays, setUnderlaysState] = useState<TraceUnderlay[]>([]);
  const [active, setActiveState] = useState(0);
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [mode, setMode] = useState<UnderlayMode>("off");
  const [scalePoints, setScalePoints] = useState<Point[]>([]);
  const [scaleText, setScaleText] = useState("3.640");
  const [pageText, setPageText] = useState("1");
  const [scaleUndo, setScaleUndo] = useState<TraceUnderlay[]>([]);
  const dragRef = useRef<{
    clientX: number;
    clientY: number;
    from: TraceUnderlay;
    /** この距離（px）以上動いたら動かすと見なす。動かさないクリックは図形の選択にそのまま渡す */
    started: boolean;
  } | null>(null);

  const underlay = underlays[active] ?? EMPTY_UNDERLAY;

  /** 選んでいる図面の番号。ドラッグ中などの古いcallbackからも常に今の番号を見るため参照で持つ */
  const activeRef = useRef(active);
  activeRef.current = active;
  /** ONの間は全部の図面が一緒に動く。ドラッグ中の古いcallbackからも今の状態を見るため参照で持つ */
  const [moveAll, setMoveAllState] = useState(false);
  const moveAllRef = useRef(moveAll);
  moveAllRef.current = moveAll;

  const setUnderlay: Dispatch<SetStateAction<TraceUnderlay>> = useCallback(
    (next) => {
      setUnderlaysState((current) => {
        const resolved =
          typeof next === "function"
            ? next(current[activeRef.current] ?? EMPTY_UNDERLAY)
            : next;
        if (current.length === 0)
          return resolved.image === "" ? current : [resolved];
        const updated = current.map((item, index) =>
          index === activeRef.current ? resolved : item,
        );
        return updated.filter((item) => item.image !== "");
      });
    },
    [],
  );

  const setUnderlays = useCallback((list: TraceUnderlay[], activeIndex = 0) => {
    const kept = list.filter((item) => item.image !== "");
    setUnderlaysState(kept);
    setActiveState(Math.min(Math.max(activeIndex, 0), kept.length - 1));
  }, []);

  const setActive = useCallback(
    (index: number) => {
      setActiveState(Math.min(Math.max(index, 0), underlays.length - 1));
    },
    [underlays.length],
  );

  const replace = useCallback(
    (before: TraceUnderlay, after: TraceUnderlay) => {
      if (commit) commit(before, after);
      setUnderlay(after);
    },
    [commit, setUnderlay],
  );

  useEffect(() => {
    underlays.forEach((item) => {
      if (item.image === "" || sizes[item.image] !== undefined) return;
      const image = new Image();
      image.onload = () =>
        setSizes((current) =>
          current[item.image] !== undefined
            ? current
            : {
                ...current,
                [item.image]: {
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                },
              },
        );
      image.src = item.image;
    });
  }, [sizes, underlays]);

  const boxes = useMemo<(UnderlayBox | null)[]>(
    () =>
      underlays.map((item) => {
        const size = sizes[item.image];
        if (item.image === "" || item.metersPerPixel <= 0 || size === undefined)
          return null;
        return {
          x: item.x,
          y: item.y,
          width: size.width * item.metersPerPixel,
          height: size.height * item.metersPerPixel,
        };
      }),
    [sizes, underlays],
  );
  const box = boxes[active] ?? null;
  const count = underlays.length;
  /** 追加する図面の置き場所（今ある図面の右横。無いときは原点） */
  const nextSpot = useMemo(() => spotBesideBoxes(boxes), [boxes]);

  const SCALE_HINT =
    "図面の中で長さの分かる所を2回クリックし、その実寸（m）を入れて［合わせる］を押してください";

  const putImage = useCallback(
    (dataUrl: string) => {
      // 複数置ける画面では、今ある図面の右横に置く（重ねると前の図面が隠れる）。1枚だけの画面は今までどおり原点
      const spot = multi ? nextSpot : { x: 0, y: 0 };
      const next: TraceUnderlay = {
        image: dataUrl,
        metersPerPixel: Math.max(planSize, 10) / 1000,
        x: spot.x,
        y: spot.y,
        opacity: 0.75,
        scaled: false,
      };
      if (multi) {
        // 2枚目以降は追加になる（選ぶ図面は足した方にする）
        setUnderlaysState((current) => {
          const kept = current.filter((item) => item.image !== "");
          return [...kept, next];
        });
        setActiveState(count);
      } else {
        replace(underlay, next);
      }
      setScalePoints([]);
      setMode("scale");
      setMessage(SCALE_HINT);
    },
    [count, multi, nextSpot, planSize, replace, setMessage, underlay],
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

  const openFiles = useCallback(async () => {
    // 1枚だけ置ける画面は今までどおり（複数選びは出さない）
    if (!multi) {
      await openFile();
      return;
    }
    const page = Number(pageText);
    setMessage("ファイルを読んでいます…");
    const got = await window.sekisan.openDrawingFiles(page > 0 ? page : 1);
    if (got.items.length === 0) {
      setMessage(got.note === "" ? "取り込みをやめました" : got.note);
      return;
    }
    const metersPerPixel = Math.max(planSize, 10) / 1000;
    let cursor = nextSpot;
    let placed = 0;
    for (const item of got.items) {
      let dataUrl = item.image;
      if (item.pdf !== "") {
        const made = await pdfPageImage(item.pdf, page > 0 ? page : 1);
        dataUrl = made.image;
        if (dataUrl === "") {
          setMessage("PDFを画像にできませんでした");
          continue;
        }
      }
      if (dataUrl === "") continue;
      // 先に大きさを読み、次の図面をこの図面の右横へずらして置く
      const size = await loadImageSize(dataUrl);
      if (size !== null)
        setSizes((current) =>
          current[dataUrl] !== undefined
            ? current
            : { ...current, [dataUrl]: size },
        );
      const next: TraceUnderlay = {
        image: dataUrl,
        metersPerPixel,
        x: cursor.x,
        y: cursor.y,
        opacity: 0.75,
        scaled: false,
      };
      setUnderlaysState((current) => [
        ...current.filter((entry) => entry.image !== ""),
        next,
      ]);
      cursor = {
        x:
          cursor.x +
          (size !== null
            ? size.width * metersPerPixel
            : Math.max(planSize, 10)) +
          0.5,
        y: cursor.y,
      };
      placed += 1;
    }
    if (placed === 0) return;
    setActiveState(count + placed - 1);
    setScalePoints([]);
    setMode("scale");
    setMessage(`${placed}枚の図面を置きました。${SCALE_HINT}`);
  }, [count, multi, nextSpot, openFile, pageText, planSize, setMessage]);

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

  const setMoveAll = useCallback((on: boolean) => setMoveAllState(on), []);

  const toggleMoveAll = useCallback(() => {
    const next = !moveAll;
    setMoveAllState(next);
    setMessage(
      next
        ? "図面をまとめて動かします（「✋ 図面を動かす」で全部の図面が一緒に動きます）"
        : "図面を1枚ずつ動かすに戻しました",
    );
  }, [moveAll, setMessage]);

  const bringFront = useCallback(() => {
    if (!multi || underlays.length < 2) return;
    const index = Math.min(
      Math.max(activeRef.current, 0),
      underlays.length - 1,
    );
    const picked = underlays[index];
    if (picked === undefined) return;
    // 後に置いた図面が上に重なるので、選んだ図面をいちばん後ろへ移す
    setUnderlaysState([...underlays.filter((_, i) => i !== index), picked]);
    setActiveState(underlays.length - 1);
    setMessage("選んでいる図面をいちばん上に出しました");
  }, [multi, setMessage, underlays]);

  const remove = useCallback(async () => {
    if (!(await ask("下敷きの図面を外します。よろしいですか"))) return;
    if (multi) {
      setUnderlaysState((current) =>
        current.filter((_, index) => index !== active),
      );
      setActiveState((current) => Math.min(current, underlays.length - 2));
    } else {
      replace(underlay, EMPTY_UNDERLAY);
    }
    setMode("off");
    setScalePoints([]);
    setScaleUndo([]);
    setMessage("下敷きの図面を外しました");
  }, [active, multi, replace, setMessage, underlay, underlays.length]);

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
        started: false,
      };
    },
    [mode, underlay],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      const start = dragRef.current;
      if (start === null) return;
      const svg = event.currentTarget;
      if (!start.started) {
        if (
          Math.hypot(
            event.clientX - start.clientX,
            event.clientY - start.clientY,
          ) < DRAG_START_PX
        )
          return;
        start.started = true;
        if (dragStart) dragStart(start.from);
        svg.setPointerCapture(event.pointerId);
      }
      const from = svgPoint(svg, start.clientX, start.clientY);
      const to = svgPoint(svg, event.clientX, event.clientY);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const moved: TraceUnderlay = {
        ...start.from,
        x: start.from.x + dx,
        y: start.from.y + dy,
      };
      if (drag) drag(start.from, moved);
      if (moveAllRef.current) {
        // まとめて動かす中は全部の図面を同じだけずらす（重ね合わせた図面がばらけない）
        setUnderlaysState((current) =>
          current.map((item) =>
            item.image === ""
              ? item
              : { ...item, x: item.x + dx, y: item.y + dy },
          ),
        );
      } else {
        setUnderlay(moved);
      }
    },
    [drag, dragStart],
  );

  const onPointerUp = useCallback((event: PointerEvent<SVGSVGElement>) => {
    const start = dragRef.current;
    if (start === null) return;
    dragRef.current = null;
    if (start.started)
      event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return {
    underlay,
    setUnderlay,
    underlays,
    setUnderlays,
    active,
    setActive,
    count,
    box,
    boxes,
    nextSpot,
    bringFront,
    moveAll,
    setMoveAll,
    toggleMoveAll,
    mode,
    scalePoints,
    scaleText,
    setScaleText,
    pageText,
    setPageText,
    canUndoScale: scaleUndo.length > 0,
    pasteImage,
    openFile,
    openFiles,
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

/**
 * 貼った図面を、図形と同じ角度・同じ起点（図の座標m）で回した下敷きに作り直す。
 * 図形を辺起点で回したあとも図面とずれないようにするためのもの。
 * 回転した画像は外接枠で貼り直すので、位置・縮尺は図形と揃ったままになる。
 */
export async function rotateUnderlay(
  underlay: TraceUnderlay,
  pivot: Point,
  pivotTo: Point,
  angle: number,
): Promise<TraceUnderlay | null> {
  if (underlay.image === "" || underlay.metersPerPixel <= 0) return null;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("画像を読めませんでした"));
    el.src = underlay.image;
  }).catch(() => null);
  if (img === null) return null;
  const mpp = underlay.metersPerPixel;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // 図形と同じ変形：起点まわりに回して、起点のあらたな位置へ置く
  const turn = (x: number, y: number): Point => {
    const dx = x - pivot.x;
    const dy = y - pivot.y;
    return {
      x: pivotTo.x + dx * cos - dy * sin,
      y: pivotTo.y + dx * sin + dy * cos,
    };
  };
  // 回った4隅の外接枠（図の座標m）を新しい置き場所にする
  const corners = [
    turn(underlay.x, underlay.y),
    turn(underlay.x + w * mpp, underlay.y),
    turn(underlay.x, underlay.y + h * mpp),
    turn(underlay.x + w * mpp, underlay.y + h * mpp),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = (Math.max(...xs) - left) / mpp;
  const height = (Math.max(...ys) - top) / mpp;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  // 画像の中の起点（画素）を、新しい外接枠での「起点のあらたな位置」へ写す
  ctx.translate((pivotTo.x - left) / mpp, (pivotTo.y - top) / mpp);
  ctx.rotate(angle);
  ctx.translate(-(pivot.x - underlay.x) / mpp, -(pivot.y - underlay.y) / mpp);
  ctx.drawImage(img, 0, 0);
  return {
    ...underlay,
    image: canvas.toDataURL("image/png"),
    x: left,
    y: top,
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
      {u.count > 1 && (
        <label
          className="snap-field"
          title="動かす・合わせる・外すの対象にする図面を選びます（選んだ図面に橙の枠が出ます）"
        >
          図面を選ぶ
          <select
            value={u.active}
            onChange={(e) => u.setActive(Number(e.target.value))}
          >
            {u.underlays.map((_, index) => (
              <option key={index} value={index}>
                図面{index + 1}
              </option>
            ))}
          </select>
        </label>
      )}
      {u.count > 1 && u.underlay.image !== "" && (
        <button
          type="button"
          title="選んでいる図面（橙枠）をいちばん上に重ねて出します（重なっている所で見える図面を変えます）"
          onClick={u.bringFront}
        >
          ⬆ 上に出す
        </button>
      )}
      {u.count > 1 && (
        <button
          type="button"
          className={u.moveAll ? "on" : ""}
          title="ONの間「✋ 図面を動かす」で全部の図面が一緒に動きます（重ね合わせたあと1枚の絵として固定したいときに）"
          onClick={u.toggleMoveAll}
        >
          🔗 まとめて動かす
        </button>
      )}
      <button
        type="button"
        title="Shift+Windows+S で切り取った図面を、図の下敷きに貼ります（図形の位置・大きさを図面と見比べながら作れます）"
        onClick={() => void u.pasteImage()}
      >
        📋 図面を貼る
      </button>
      <button
        type="button"
        title="PDF・画像のファイルを選んで、図の下敷きに貼ります（複数まとめて選ぶと横に並べて置きます）"
        onClick={() => void u.openFiles()}
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

/** svg の中に置く下敷きの画像（いちばん下に描く）。置いた図面は全部重ねて出す */
export function UnderlayImage({ u }: { u: Underlay }): JSX.Element | null {
  const drawn = u.underlays
    .map((item, index) => ({ item, index, box: u.boxes[index] ?? null }))
    .filter(({ box }) => box !== null);
  if (drawn.length === 0) return null;
  return (
    <>
      {drawn.map(({ item, index, box }) => (
        <g key={index}>
          <image
            href={item.image}
            x={box!.x}
            y={box!.y}
            width={box!.width}
            height={box!.height}
            preserveAspectRatio="none"
            opacity={item.opacity}
            className="underlay-image"
            style={{ pointerEvents: u.mode === "off" ? "none" : "auto" }}
          />
          {/* 図面が2枚以上あるときは、ボタンが効く図面に橙の枠を出す */}
          {u.count > 1 && index === u.active && (
            <rect
              x={box!.x}
              y={box!.y}
              width={box!.width}
              height={box!.height}
              fill="none"
              stroke="#e8590c"
              strokeWidth="2"
              strokeDasharray="8 4"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
        </g>
      ))}
    </>
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
