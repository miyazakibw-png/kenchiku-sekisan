import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { extname, join } from "path";
import { tmpdir } from "os";

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
};

/** 画像ファイルを読んでdata URLにする（読めなければ空文字） */
export function fileToDataUrl(path: string): string {
  const type = IMAGE_TYPES[extname(path).toLowerCase()];
  if (type === undefined || !existsSync(path)) return "";
  try {
    return `data:${type};base64,${readFileSync(path).toString("base64")}`;
  } catch {
    return "";
  }
}

/**
 * Windowsのクリップボードを、ワードと同じやり方で読むための命令書。
 * 絵（ビットマップ）・拡張メタファイル（EMF）・コピーした画像ファイルの中から、
 * いちばん大きい（＝細かい）ものを選んでPNGに保存する。
 */
const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public class SekisanClip {
  [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
  [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CopyEnhMetaFile(IntPtr source, string file);
  public static string SaveMetafile(string path) {
    if (!OpenClipboard(IntPtr.Zero)) return "";
    try {
      IntPtr handle = GetClipboardData(14);
      if (handle == IntPtr.Zero) return "";
      IntPtr copy = CopyEnhMetaFile(handle, null);
      if (copy == IntPtr.Zero) return "";
      using (Metafile meta = new Metafile(copy, true)) {
        int width = meta.Width;
        int height = meta.Height;
        if (width <= 0 || height <= 0) return "";
        float scale = 2f;
        if (width * scale > 4000) scale = 4000f / width;
        if (height * scale > 4000) scale = 4000f / height;
        if (scale < 1f) scale = 1f;
        using (Bitmap bitmap = new Bitmap((int)(width * scale), (int)(height * scale))) {
          using (Graphics graphics = Graphics.FromImage(bitmap)) {
            graphics.Clear(Color.White);
            graphics.ScaleTransform(scale, scale);
            graphics.DrawImage(meta, 0, 0);
          }
          bitmap.Save(path, ImageFormat.Png);
        }
        return path;
      }
    } catch (Exception) {
      return "";
    } finally {
      CloseClipboard();
    }
  }
}
"@
$data = [Windows.Forms.Clipboard]::GetDataObject()
$formats = ''
if ($data -ne $null) { $formats = ($data.GetFormats() -join ',') }
$best = ''
$bestPixels = 0
if ([Windows.Forms.Clipboard]::ContainsFileDropList()) {
  foreach ($file in [Windows.Forms.Clipboard]::GetFileDropList()) {
    if ($file -match '\.(png|jpg|jpeg|gif|bmp|webp)$') { $best = $file; $bestPixels = [int]::MaxValue; break }
  }
}
if ($bestPixels -lt [int]::MaxValue) {
  try {
    $emf = Join-Path $env:TEMP 'sekisan_clip_emf.png'
    Remove-Item $emf -Force -ErrorAction SilentlyContinue
    if ([SekisanClip]::SaveMetafile($emf) -ne '' -and (Test-Path $emf)) {
      $image = [Drawing.Image]::FromFile($emf)
      $pixels = $image.Width * $image.Height
      $image.Dispose()
      if ($pixels -gt $bestPixels) { $best = $emf; $bestPixels = $pixels }
    }
  } catch { }
  if ([Windows.Forms.Clipboard]::ContainsImage()) {
    $bitmap = [Windows.Forms.Clipboard]::GetImage()
    if ($bitmap -ne $null) {
      $pixels = $bitmap.Width * $bitmap.Height
      if ($pixels -gt $bestPixels) {
        $path = Join-Path $env:TEMP 'sekisan_clip_bmp.png'
        $bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png)
        $best = $path
        $bestPixels = $pixels
      }
      $bitmap.Dispose()
    }
  }
}
Write-Output ("FORMATS:" + $formats)
Write-Output ("PATH:" + $best)
`;

export interface ClipboardImage {
  image: string;
  note: string;
}

/**
 * Windowsのクリップボードから図面の画像を取り出す。
 * 切り取り（Shift+Windows+S）・コピーした画像ファイル・ワードなどからのコピーに対応。
 */
export function readWindowsClipboardImage(): ClipboardImage {
  if (process.platform !== "win32") return { image: "", note: "" };
  const scriptFile = join(tmpdir(), "sekisan_clipboard.ps1");
  let output = "";
  try {
    writeFileSync(scriptFile, SCRIPT, "utf8");
    output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Sta", "-File", scriptFile],
      { encoding: "utf8", timeout: 15000, windowsHide: true },
    );
  } catch {
    return { image: "", note: "Windowsのクリップボードを読めませんでした" };
  }
  const formats =
    /FORMATS:(.*)/.exec(output)?.[1].trim().replace(/,/g, " / ") ?? "";
  const path = /PATH:(.*)/.exec(output)?.[1].trim() ?? "";
  if (path === "") return { image: "", note: `画像なし（${formats}）` };
  const image = fileToDataUrl(path);
  if (image === "") return { image: "", note: `読めません（${formats}）` };
  const kind = path.endsWith("sekisan_clip_emf.png")
    ? "図（メタファイル）"
    : path.endsWith("sekisan_clip_bmp.png")
      ? "絵"
      : "ファイル";
  return { image, note: `${kind}（${formats}）` };
}
