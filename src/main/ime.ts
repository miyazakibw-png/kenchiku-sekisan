/**
 * 欄ごとにWindowsの日本語入力（IME）を切り替える。
 * Windows以外・部品を読み込めない環境では何もしない。
 */
import type { BrowserWindow } from 'electron'
import type { ImeMode } from '../shared/types'

const WM_IME_CONTROL = 0x0283
const IMC_SETCONVERSIONMODE = 0x0002
const IMC_SETOPENSTATUS = 0x0006
/** ひらがな（全角・ローマ字入力） */
const HIRAGANA_MODE = 0x0001 | 0x0008 | 0x0010
const GW_CHILD = 5
const GW_HWNDNEXT = 2

/** 窓の番号（HWND）。koffiは大きさによって数値・BigIntのどちらでも返す */
type Handle = number | bigint

interface Win32Api {
  immGetDefaultIMEWnd: (hwnd: Handle) => Handle
  sendMessage: (hwnd: Handle, message: number, wParam: number, lParam: number) => Handle
  getWindow: (hwnd: Handle, command: number) => Handle
}

function toHandle(value: Handle): bigint {
  return BigInt(value)
}

let api: Win32Api | null = null
let loaded = false

async function loadApi(): Promise<Win32Api | null> {
  if (loaded) return api
  loaded = true
  if (process.platform !== 'win32') return null
  try {
    const imported = await import('koffi')
    const koffi = imported.default
    const user32 = koffi.load('user32.dll')
    const imm32 = koffi.load('imm32.dll')
    api = {
      immGetDefaultIMEWnd: imm32.func('__stdcall', 'ImmGetDefaultIMEWnd', 'uintptr', ['uintptr']),
      sendMessage: user32.func('__stdcall', 'SendMessageW', 'intptr', [
        'uintptr',
        'uint',
        'uintptr',
        'uintptr'
      ]),
      getWindow: user32.func('__stdcall', 'GetWindow', 'uintptr', ['uintptr', 'uint'])
    }
  } catch (error) {
    console.warn('日本語入力の切り替え部品を読み込めませんでした', error)
    api = null
  }
  return api
}

/** 窓とその子の窓（Chromiumは子の窓が入力を受け取ることがある） */
function windowHandles(win32: Win32Api, top: bigint): bigint[] {
  const handles = [top]
  let child = toHandle(win32.getWindow(top, GW_CHILD))
  for (let depth = 0; depth < 8 && child !== 0n; depth += 1) {
    handles.push(child)
    const inner = toHandle(win32.getWindow(child, GW_CHILD))
    if (inner !== 0n) handles.push(inner)
    child = toHandle(win32.getWindow(child, GW_HWNDNEXT))
  }
  return handles
}

export async function setImeMode(window: BrowserWindow, mode: ImeMode): Promise<void> {
  const win32 = await loadApi()
  if (win32 === null || window.isDestroyed()) return
  const top = window.getNativeWindowHandle().readBigUInt64LE(0)
  const open = mode === 'hiragana'

  for (const handle of windowHandles(win32, top)) {
    const ime = toHandle(win32.immGetDefaultIMEWnd(handle))
    if (ime === 0n) continue
    win32.sendMessage(ime, WM_IME_CONTROL, IMC_SETOPENSTATUS, open ? 1 : 0)
    if (open) {
      win32.sendMessage(ime, WM_IME_CONTROL, IMC_SETCONVERSIONMODE, HIRAGANA_MODE)
    }
  }
}
