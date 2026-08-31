import { BrowserWindow, nativeImage, type NativeImage } from "electron";
import { pathToFileURL } from "url";

const WIDTH = 2200;
const HEIGHT = 1600;

/** 画面まわりの余白（PDF表示の灰色）を切り取る */
function trim(image: NativeImage): NativeImage {
  const size = image.getSize();
  const bitmap = image.toBitmap();
  const at = (x: number, y: number): number => (y * size.width + x) * 4;
  const near = (index: number): boolean =>
    Math.abs(bitmap[index] - bitmap[0]) < 12 &&
    Math.abs(bitmap[index + 1] - bitmap[1]) < 12 &&
    Math.abs(bitmap[index + 2] - bitmap[2]) < 12;
  let left = 0;
  let right = size.width - 1;
  let top = 0;
  let bottom = size.height - 1;
  const columnIsBack = (x: number): boolean => {
    for (let y = 0; y < size.height; y += 4) if (!near(at(x, y))) return false;
    return true;
  };
  const rowIsBack = (y: number): boolean => {
    for (let x = 0; x < size.width; x += 4) if (!near(at(x, y))) return false;
    return true;
  };
  while (left < right && columnIsBack(left)) left += 1;
  while (right > left && columnIsBack(right)) right -= 1;
  while (top < bottom && rowIsBack(top)) top += 1;
  while (bottom > top && rowIsBack(bottom)) bottom -= 1;
  const width = right - left + 1;
  const height = bottom - top + 1;
  if (width < 40 || height < 40) return image;
  return image.crop({ x: left, y: top, width, height });
}

/**
 * PDFの1ページを画像（data URL）にする。
 * 見えない画面でPDFを開いて、そのまま写し取る（オフラインのまま）。
 */
export async function pdfPageImage(
  file: string,
  page: number,
): Promise<string> {
  const window = new BrowserWindow({
    show: false,
    width: WIDTH,
    height: HEIGHT,
    webPreferences: { plugins: true, offscreen: true },
  });
  try {
    const url = `${pathToFileURL(file).href}#toolbar=0&navpanes=0&view=Fit&page=${page}`;
    await window.loadURL(url);
    await new Promise((done) => setTimeout(done, 2500));
    const shot = await window.webContents.capturePage();
    if (shot.isEmpty()) return "";
    const image = trim(shot);
    return nativeImage.createFromBuffer(image.toPNG()).toDataURL();
  } finally {
    window.destroy();
  }
}
