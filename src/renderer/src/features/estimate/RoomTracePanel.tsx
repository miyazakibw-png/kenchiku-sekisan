import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { Point, RoomShape } from "../../../../core/room/shape";
import {
  EMPTY_TRACE,
  longestEdgePixels,
  metersPerPixel,
  pointsToShape,
  snapToAxis,
  toMeters,
  traceArea,
  type RoomTrace,
} from "../../../../core/room/trace";
import { pdfPageImage } from "./pdfPage";
import "./RoomTracePanel.css";

interface Props {
  trace: RoomTrace;
  onChange: (trace: RoomTrace) => void;
  /** なぞった形を使う（meters は実寸（m）の点の並び。ピットの形にも使う） */
  onApply: (shape: RoomShape, meters: Point[]) => void;
  onClose: () => void;
  /** 見出しの名前（部屋・ピットなど） */
  targetName?: string;
}

/** 画像の大きさ（画素）。読み込むまでは仮の大きさ */
interface ImageSize {
  width: number;
  height: number;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("画像を読めませんでした"));
    reader.readAsDataURL(file);
  });
}

/**
 * 図面画像をなぞって部屋形状を作る画面。
 * 画像は Shift+Windows+S で切り取って Ctrl+V で貼り付けるのが主な使い方。
 */
export default function RoomTracePanel({
  trace,
  onChange,
  onApply,
  onClose,
  targetName = "部屋",
}: Props): JSX.Element {
  const [size, setSize] = useState<ImageSize>({ width: 1000, height: 700 });
  const [mode, setMode] = useState<"scale" | "trace">("scale");
  const [scalePoints, setScalePoints] = useState<Point[]>(trace.scalePoints);
  const [scaleText, setScaleText] = useState(
    trace.scaleLength > 0 ? String(trace.scaleLength) : "3.640",
  );
  const [points, setPoints] = useState<Point[]>(trace.points);
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pageText, setPageText] = useState("1");
  const [edgeText, setEdgeText] = useState("3.640");
  const [warn, setWarn] = useState(false);
  const [message, setMessage] = useState(
    "Shift+Windows+S で図面を切り取り、この画面で Ctrl+V を押すと貼り付きます",
  );
  const boxRef = useRef<HTMLDivElement | null>(null);

  const perPixel = trace.metersPerPixel;

  // 画像の大きさ（画素）を測る
  useEffect(() => {
    if (trace.image === "") return;
    const image = new Image();
    image.onload = () =>
      setSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = trace.image;
  }, [trace.image]);

  const setImage = useCallback(
    (dataUrl: string) => {
      onChange({
        image: dataUrl,
        metersPerPixel: 0,
        scalePoints: [],
        scaleLength: 0,
        points: [],
      });
      setScalePoints([]);
      setPoints([]);
      setMode("scale");
      setMessage(
        "図の中で長さの分かる所を2回クリックし、その実寸（m）を入れてください",
      );
    },
    [onChange],
  );

  /** Windowsのクリップボードから画像を取り込む（Shift+Windows+S の切り取り） */
  const pasteImage = useCallback(
    async (fallback?: File): Promise<void> => {
      const fromApp = await window.sekisan.readClipboardImage();
      if (fromApp.image !== "") {
        setImage(fromApp.image);
        setMessage(`貼り付けました：${fromApp.note}`);
        return;
      }
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((entry) => entry.startsWith("image/"));
          if (type === undefined) continue;
          setImage(await readAsDataUrl(await item.getType(type)));
          setMessage(`貼り付けました：${type}（中身：${fromApp.note}）`);
          return;
        }
      } catch {
        // クリップボードを読めないときは、貼り付けに付いてきたファイルを使う
      }
      if (fallback) {
        setImage(await readAsDataUrl(fallback));
        setMessage(`貼り付けました：${fallback.name}（中身：${fromApp.note}）`);
        return;
      }
      setMessage(`クリップボードに画像がありません（中身：${fromApp.note}）`);
    },
    [setImage],
  );

  // PDF・画像のファイルを選んで図面にする
  const openFile = useCallback(async (): Promise<void> => {
    const page = Number(pageText);
    setMessage("ファイルを読んでいます…");
    const got = await window.sekisan.openDrawingFile(page > 0 ? page : 1);
    if (got.pdf !== "") {
      try {
        const made = await pdfPageImage(got.pdf, page > 0 ? page : 1);
        if (made.image === "") {
          setMessage("PDFを画像にできませんでした");
          return;
        }
        setImage(made.image);
        setMessage(
          `読み込みました：PDF ${Math.min(Math.max(page > 0 ? page : 1, 1), made.pages)}ページ（全${made.pages}ページ）`,
        );
      } catch {
        setMessage("PDFを読めませんでした");
      }
      return;
    }
    if (got.image === "") {
      setMessage(got.note);
      return;
    }
    setImage(got.image);
    setMessage(`読み込みました：${got.note}`);
  }, [pageText, setImage]);

  // Ctrl+V で貼り付け（Shift+Windows+S で切り取った画面をそのまま使う）
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      event.preventDefault();
      const file = Array.from(event.clipboardData?.files ?? []).find((entry) =>
        entry.type.startsWith("image/"),
      );
      void pasteImage(file);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKeyDown);
    boxRef.current?.focus();
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, pasteImage, setImage]);

  /** 画像の画素座標へ直す */
  const pointAt = (event: React.MouseEvent<SVGSVGElement>): Point | null => {
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const origin = svg.createSVGPoint();
    origin.x = event.clientX;
    origin.y = event.clientY;
    const local = origin.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  };

  const click = (event: React.MouseEvent<SVGSVGElement>): void => {
    const point = pointAt(event);
    if (point === null || trace.image === "") return;
    if (mode === "scale") {
      const next = scalePoints.length >= 2 ? [point] : [...scalePoints, point];
      setScalePoints(next);
      setMessage(
        next.length < 2
          ? "もう1点クリックしてください"
          : "実寸（m）を入れて「縮尺を決める」を押してください",
      );
      return;
    }
    const previous = points[points.length - 1];
    const placed = snap && previous ? snapToAxis(previous, point) : point;
    setPoints([...points, placed]);
  };

  const fixScale = (): void => {
    const length = Number(scaleText);
    if (scalePoints.length < 2 || !(length > 0)) {
      setMessage("2点をクリックしてから、実寸（m）を入れてください");
      return;
    }
    const value = metersPerPixel(scalePoints[0], scalePoints[1], length);
    if (value === 0) {
      setMessage("2点が同じ場所です。離れた2点をクリックしてください");
      return;
    }
    onChange({
      ...trace,
      metersPerPixel: value,
      scalePoints,
      scaleLength: length,
      points,
    });
    setMode("trace");
    setMessage(
      `${targetName}の角を順にクリックしてなぞってください（直角に合わせます）。最後に「この形にする」`,
    );
  };

  const keep = (next: Point[]): void => {
    setPoints(next);
    onChange({ ...trace, scalePoints, points: next });
  };

  const apply = (): void => {
    if (points.length < 3) {
      setWarn(true);
      setMessage(`${targetName}の角を3点以上クリックしてください`);
      return;
    }
    // 縮尺がまだのときは「一番長い辺の実寸」から出す（やり直さずに済むように）
    let value = perPixel;
    if (value === 0) {
      const length = Number(edgeText);
      const pixels = longestEdgePixels(points);
      value = pixels === 0 || !(length > 0) ? 0 : length / pixels;
      if (value === 0) {
        setWarn(true);
        setMessage(
          "縮尺がまだです。「① 縮尺合わせ」で決めるか、下の「一番長い辺の実寸」に長さ（m）を入れてください",
        );
        return;
      }
    }
    const meters = toMeters(points, value);
    const shape = pointsToShape(meters);
    setWarn(false);
    onChange({ ...trace, metersPerPixel: value, scalePoints, points });
    onApply(shape, meters);
  };

  const area =
    perPixel === 0 || points.length < 3
      ? null
      : traceArea(toMeters(points, perPixel));

  const polygon = points.map((point) => `${point.x},${point.y}`).join(" ");
  const dotSize = Math.max(size.width, size.height) / 150;

  return (
    <div className="room-trace-panel">
      <div className="section-bar">
        <span>図面をなぞる</span>
        <button
          type="button"
          className={mode === "scale" ? "on" : ""}
          onClick={() => setMode("scale")}
        >
          ① 縮尺合わせ
        </button>
        <button
          type="button"
          className={mode === "trace" ? "on" : ""}
          onClick={() => {
            setMode("trace");
            setWarn(perPixel === 0);
            setMessage(
              perPixel === 0
                ? `縮尺がまだです。${targetName}の角をなぞったあと、下の「一番長い辺の実寸」に長さ（m）を入れて「✓ この形にする」を押してください`
                : `${targetName}の角を順にクリックしてなぞってください。最後に「✓ この形にする」`,
            );
          }}
        >
          ② なぞる
        </button>
        <button
          type="button"
          title="PDFや画像のファイルを選んで図面にします（PDFは右のページを画像にします）"
          onClick={() => void openFile()}
        >
          📂 画像・PDFを開く
        </button>
        <label className="page">
          ページ
          <input
            type="number"
            min={1}
            value={pageText}
            onChange={(event) => setPageText(event.target.value)}
          />
        </label>
        <button
          type="button"
          title="Shift+Windows+S で切り取った画像を貼り付けます（この画面で Ctrl+V でも貼れます）"
          onClick={() => void pasteImage()}
        >
          📋 画像を貼り付け
        </button>
        <button
          type="button"
          title={`貼った図面となぞりを消します（${targetName}の形はそのまま残ります）`}
          disabled={trace.image === ""}
          onClick={() => {
            onChange({ ...EMPTY_TRACE });
            setScalePoints([]);
            setPoints([]);
            setMode("scale");
            setMessage(`図面を消しました（${targetName}の形はそのままです）`);
          }}
        >
          🗑 画像を消す
        </button>
        <button type="button" onClick={() => setZoom(Math.min(zoom * 1.25, 8))}>
          ＋
        </button>
        <button
          type="button"
          onClick={() => setZoom(Math.max(zoom / 1.25, 0.2))}
        >
          －
        </button>
        <button type="button" onClick={() => setZoom(1)}>
          等倍
        </button>
        <button type="button" onClick={onClose}>
          ✕ 閉じる
        </button>
      </div>

      <div className="trace-tools">
        {mode === "scale" ? (
          <>
            <span>この2点の実寸</span>
            <input
              className="num"
              value={scaleText}
              onChange={(event) => setScaleText(event.target.value)}
            />
            <span>m</span>
            <button type="button" onClick={fixScale}>
              縮尺を決める
            </button>
            <button
              type="button"
              title="縮尺合わせに引いた赤い線（2点）を消します。決めた縮尺はそのまま使えます"
              disabled={scalePoints.length === 0}
              onClick={() => {
                setScalePoints([]);
                onChange({ ...trace, scalePoints: [], points });
                setMessage(
                  perPixel === 0
                    ? "赤い線を消しました。2点をクリックし直してください"
                    : "赤い線を消しました（縮尺はそのままです）",
                );
              }}
            >
              赤線を消す
            </button>
          </>
        ) : (
          <>
            <label className="snap">
              <input
                type="checkbox"
                checked={snap}
                onChange={(event) => setSnap(event.target.checked)}
              />
              直角に合わせる
            </label>
            <button
              type="button"
              onClick={() => keep(points.slice(0, -1))}
              disabled={points.length === 0}
            >
              ↶ 1点戻す
            </button>
            <button
              type="button"
              onClick={() => keep([])}
              disabled={points.length === 0}
            >
              なぞりを消す
            </button>
            {perPixel === 0 ? (
              <label className="edge">
                一番長い辺の実寸
                <input
                  className="num"
                  value={edgeText}
                  onChange={(event) => setEdgeText(event.target.value)}
                />
                m
              </label>
            ) : null}
            <button type="button" className="apply" onClick={apply}>
              ✓ この形にする
            </button>
          </>
        )}
        <span className="scale-note">
          {perPixel === 0
            ? "縮尺 未設定"
            : `縮尺 1画素＝${(perPixel * 1000).toFixed(1)}mm`}
        </span>
        {area === null ? null : (
          <span className="area">なぞった面積 {area.toFixed(2)}㎡</span>
        )}
      </div>

      <div
        className="trace-body"
        ref={boxRef}
        tabIndex={-1}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          const file = Array.from(event.dataTransfer.files).find((entry) =>
            entry.type.startsWith("image/"),
          );
          if (!file) return;
          event.preventDefault();
          void readAsDataUrl(file).then(setImage);
        }}
      >
        {trace.image === "" ? (
          <p className="empty">
            Shift+Windows+S で図面を切り取り、この画面で Ctrl+V
            を押すと貼り付きます（「📂 画像・PDFを開く」でPDFや画像ファイルからも読めます）
          </p>
        ) : (
          <svg
            viewBox={`0 0 ${size.width} ${size.height}`}
            style={{ width: `${size.width * zoom}px` }}
            onClick={click}
          >
            <image href={trace.image} width={size.width} height={size.height} />
            {scalePoints.length === 2 ? (
              <line
                className="scale-line"
                x1={scalePoints[0].x}
                y1={scalePoints[0].y}
                x2={scalePoints[1].x}
                y2={scalePoints[1].y}
                strokeWidth={dotSize / 2}
              />
            ) : null}
            {scalePoints.map((point, index) => (
              <circle
                key={`s${index}`}
                className="scale-dot"
                cx={point.x}
                cy={point.y}
                r={dotSize}
              />
            ))}
            {points.length >= 2 ? (
              <polygon
                className="trace-shape"
                points={polygon}
                strokeWidth={dotSize / 2}
              />
            ) : null}
            {points.map((point, index) => (
              <circle
                key={`p${index}`}
                className="trace-dot"
                cx={point.x}
                cy={point.y}
                r={dotSize}
              />
            ))}
          </svg>
        )}
      </div>

      <p className={warn ? "trace-message warn" : "trace-message"}>{message}</p>
    </div>
  );
}
