import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

/** 図面として使いやすい大きさ（横幅の目安） */
const TARGET_WIDTH = 2000;

function toBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** PDFの指定ページを画像（data URL）にする。オフラインのまま動きます。 */
export async function pdfPageImage(
  base64: string,
  page: number,
): Promise<{ image: string; pages: number }> {
  const document = await getDocument({ data: toBytes(base64) }).promise;
  const pages = document.numPages;
  const number = Math.min(Math.max(page, 1), pages);
  const target = await document.getPage(number);
  const first = target.getViewport({ scale: 1 });
  const scale = Math.min(4, Math.max(1, TARGET_WIDTH / first.width));
  const viewport = target.getViewport({ scale });
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext("2d");
  if (context === null) return { image: "", pages };
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await target.render({ canvasContext: context, viewport }).promise;
  return { image: canvas.toDataURL("image/png"), pages };
}
