/**
 * 欄ごとにWindowsの日本語入力（IME）を切り替える。
 * Windows以外・部品を読み込めない環境では何もしない。
 */
import type { BrowserWindow } from 'electron'
import type { ImeMode } from '../shared/types'

const WM_IME_CONTROL = 0x0283
const IMC_SETCONVERSIONMODE = 0x0002
const IMC_SETOPENSTATUS = 0x0006
/** ひらがな（全角） */
const HIRAGANA_MODE = 0x0001 | 0x0008
/** ローマ字入力 */
const IME_CMODE_ROMAN = 0x0010
/** 文の変換のしかた（0のままにすると漢字変換ができなくなる） */
const IME_SMODE_PHRASEPREDICT = 0x0008
const GW_CHILD = 5
const GW_HWNDNEXT = 2

/** 窓の番号（HWND）。koffiは大きさによって数値・BigIntのどちらでも返す */
type Handle = number | bigint

interface GuiThreadInfo {
  cbSize: number
  flags: number
  hwndActive: Handle
  hwndFocus: Handle
  hwndCapture: Handle
  hwndMenuOwner: Handle
  hwndMoveSize: Handle
  hwndCaret: Handle
  rcCaret: { left: number; top: number; right: number; bottom: number }
}

interface Win32Api {
  getGuiThreadInfo: (threadId: number, info: GuiThreadInfo) => number
  getWindow: (hwnd: Handle, command: number) => Handle
  sendMessage: (hwnd: Handle, message: number, wParam: number, lParam: number) => Handle
  immGetDefaultIMEWnd: (hwnd: Handle) => Handle
  immGetContext: (hwnd: Handle) => Handle
  immReleaseContext: (hwnd: Handle, context: Handle) => number
  immSetOpenStatus: (context: Handle, open: number) => number
  immGetConversionStatus: (
    context: Handle,
    conversion: number[],
    sentence: number[]
  ) => number
  immSetConversionStatus: (context: Handle, conversion: number, sentence: number) => number
}

let api: Win32Api | null = null
let loadError = ''
let loaded = false

function toHandle(value: Handle): bigint {
  return BigInt(value)
}

function emptyGuiThreadInfo(): GuiThreadInfo {
  return {
    cbSize: 72,
    flags: 0,
    hwndActive: 0,
    hwndFocus: 0,
    hwndCapture: 0,
    hwndMenuOwner: 0,
    hwndMoveSize: 0,
    hwndCaret: 0,
    rcCaret: { left: 0, top: 0, right: 0, bottom: 0 }
  }
}

async function loadApi(): Promise<Win32Api | null> {
  if (loaded) return api
  loaded = true
  if (process.platform !== 'win32') {
    loadError = 'Windows以外では切り替えできません'
    return null
  }
  try {
    const imported = await import('koffi')
    const koffi = imported.default
    const user32 = koffi.load('user32.dll')
    const imm32 = koffi.load('imm32.dll')
    koffi.struct('SEKISAN_RECT', {
      left: 'int32',
      top: 'int32',
      right: 'int32',
      bottom: 'int32'
    })
    koffi.struct('SEKISAN_GUITHREADINFO', {
      cbSize: 'uint32',
      flags: 'uint32',
      hwndActive: 'uintptr',
      hwndFocus: 'uintptr',
      hwndCapture: 'uintptr',
      hwndMenuOwner: 'uintptr',
      hwndMoveSize: 'uintptr',
      hwndCaret: 'uintptr',
      rcCaret: 'SEKISAN_RECT'
    })
    api = {
      getGuiThreadInfo: user32.func('__stdcall', 'GetGUIThreadInfo', 'int', [
        'uint32',
        koffi.inout(koffi.pointer('SEKISAN_GUITHREADINFO'))
      ]),
      getWindow: user32.func('__stdcall', 'GetWindow', 'uintptr', ['uintptr', 'uint']),
      sendMessage: user32.func('__stdcall', 'SendMessageW', 'intptr', [
        'uintptr',
        'uint',
        'uintptr',
        'uintptr'
      ]),
      immGetDefaultIMEWnd: imm32.func('__stdcall', 'ImmGetDefaultIMEWnd', 'uintptr', ['uintptr']),
      immGetContext: imm32.func('__stdcall', 'ImmGetContext', 'uintptr', ['uintptr']),
      immReleaseContext: imm32.func('__stdcall', 'ImmReleaseContext', 'int', [
        'uintptr',
        'uintptr'
      ]),
      immSetOpenStatus: imm32.func('__stdcall', 'ImmSetOpenStatus', 'int', ['uintptr', 'int']),
      immGetConversionStatus: imm32.func('__stdcall', 'ImmGetConversionStatus', 'int', [
        'uintptr',
        koffi.out(koffi.pointer('uint32')),
        koffi.out(koffi.pointer('uint32'))
      ]),
      immSetConversionStatus: imm32.func('__stdcall', 'ImmSetConversionStatus', 'int', [
        'uintptr',
        'uint32',
        'uint32'
      ])
    }
  } catch (error) {
    loadError = String(error)
    console.warn('日本語入力の切り替え部品を読み込めませんでした', error)
    api = null
  }
  return api
}

/** 入力を受け取っている窓（Chromiumは子の窓が受け取ることがある） */
function windowHandles(win32: Win32Api, top: bigint): bigint[] {
  const handles: bigint[] = []
  const info = emptyGuiThreadInfo()
  if (win32.getGuiThreadInfo(0, info) !== 0) {
    const focus = toHandle(info.hwndFocus)
    if (focus !== 0n) handles.push(focus)
  }
  if (!handles.includes(top)) handles.push(top)

  let child = toHandle(win32.getWindow(top, GW_CHILD))
  for (let count = 0; count < 8 && child !== 0n; count += 1) {
    if (!handles.includes(child)) handles.push(child)
    const inner = toHandle(win32.getWindow(child, GW_CHILD))
    if (inner !== 0n && !handles.includes(inner)) handles.push(inner)
    child = toHandle(win32.getWindow(child, GW_HWNDNEXT))
  }
  return handles
}

/**
 * 日本語入力を切り替える。うまくいかないときのために、何をしたかの記録を返す。
 */
export async function setImeMode(window: BrowserWindow, mode: ImeMode): Promise<string> {
  const win32 = await loadApi()
  if (win32 === null) return `切り替えできません：${loadError}`
  if (window.isDestroyed()) return '画面がありません'

  const top = window.getNativeWindowHandle().readBigUInt64LE(0)
  const open = mode === 'hiragana'
  const report: string[] = [`種類=${mode}`]

  for (const handle of windowHandles(win32, top)) {
    const context = toHandle(win32.immGetContext(handle))
    let hiragana = HIRAGANA_MODE | IME_CMODE_ROMAN
    if (context !== 0n) {
      const conversion = [0]
      const sentence = [0]
      const read = win32.immGetConversionStatus(context, conversion, sentence)
      if (read !== 0) hiragana = HIRAGANA_MODE | (conversion[0] & IME_CMODE_ROMAN)
      const keep = read !== 0 && sentence[0] !== 0 ? sentence[0] : IME_SMODE_PHRASEPREDICT
      const opened = win32.immSetOpenStatus(context, open ? 1 : 0)
      let converted = 0
      if (open) converted = win32.immSetConversionStatus(context, hiragana, keep)
      win32.immReleaseContext(handle, context)
      report.push(`窓${handle}: 入力状態=${opened} 変換=${converted} 文=${keep}`)
    }

    const ime = toHandle(win32.immGetDefaultIMEWnd(handle))
    if (ime === 0n) continue
    win32.sendMessage(ime, WM_IME_CONTROL, IMC_SETOPENSTATUS, open ? 1 : 0)
    if (open) win32.sendMessage(ime, WM_IME_CONTROL, IMC_SETCONVERSIONMODE, hiragana)
    report.push(`窓${handle}: IMEの窓=${ime}`)
  }

  if (report.length === 1) report.push('日本語入力の入り口が見つかりませんでした')
  return report.join(' / ')
}
