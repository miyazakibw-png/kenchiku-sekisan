/**
 * 積算で使う四則演算の計算式を評価する。
 * Excelの計算式と同じ感覚で `1.2*2.4+0.3` のように書ける。
 * 変数（W・H など）を渡すと式の中で使える。
 */

const OPERATORS: Record<string, { precedence: number; apply: (a: number, b: number) => number }> = {
  '+': { precedence: 1, apply: (a, b) => a + b },
  '-': { precedence: 1, apply: (a, b) => a - b },
  '*': { precedence: 2, apply: (a, b) => a * b },
  '/': { precedence: 2, apply: (a, b) => a / b }
}

/** 全角の記号・数字をそのまま計算できるように直す */
export function normalizeFormula(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[×＊]/g, '*')
    .replace(/[÷／]/g, '/')
    .replace(/[＋]/g, '+')
    .replace(/[－ー−]/g, '-')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[．]/g, '.')
    .replace(/\s+/g, '')
}

type Token = { kind: 'number'; value: number } | { kind: 'symbol'; value: string }

function tokenize(text: string, variables: Record<string, number>): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (char >= '0' && char <= '9') {
      let j = i
      while (j < text.length && ((text[j] >= '0' && text[j] <= '9') || text[j] === '.')) j++
      const value = Number(text.slice(i, j))
      if (Number.isNaN(value)) return null
      tokens.push({ kind: 'number', value })
      i = j
      continue
    }
    if (char in OPERATORS || char === '(' || char === ')') {
      tokens.push({ kind: 'symbol', value: char })
      i += 1
      continue
    }
    // 変数名（長い名前から順に照合する）
    const name = Object.keys(variables)
      .filter((key) => text.startsWith(key, i))
      .sort((a, b) => b.length - a.length)[0]
    if (!name) return null
    tokens.push({ kind: 'number', value: variables[name] })
    i += name.length
  }
  return tokens
}

/**
 * 計算式を評価する。式が空・不正な場合は null を返す（利用側でエラー表示する）。
 */
export function evaluateFormula(
  formula: string,
  variables: Record<string, number> = {}
): number | null {
  const text = normalizeFormula(formula)
  if (text === '') return null
  const tokens = tokenize(text, variables)
  if (!tokens) return null

  const values: number[] = []
  const operators: string[] = []

  const applyTop = (): boolean => {
    const operator = operators.pop()
    const right = values.pop()
    const left = values.pop()
    if (operator === undefined || right === undefined || left === undefined) return false
    values.push(OPERATORS[operator].apply(left, right))
    return true
  }

  let expectValue = true
  for (const token of tokens) {
    if (token.kind === 'number') {
      if (!expectValue) return null
      values.push(token.value)
      expectValue = false
      continue
    }
    if (token.value === '(') {
      if (!expectValue) return null
      operators.push('(')
      continue
    }
    if (token.value === ')') {
      if (expectValue) return null
      while (operators.length > 0 && operators[operators.length - 1] !== '(') {
        if (!applyTop()) return null
      }
      if (operators.pop() !== '(') return null
      continue
    }
    // 先頭やカッコ直後の - は符号として扱う
    if (expectValue) {
      if (token.value !== '-' && token.value !== '+') return null
      values.push(0)
    }
    const operator = OPERATORS[token.value]
    while (operators.length > 0 && operators[operators.length - 1] !== '(') {
      const top = OPERATORS[operators[operators.length - 1]]
      if (top.precedence < operator.precedence) break
      if (!applyTop()) return null
    }
    operators.push(token.value)
    expectValue = true
  }
  if (expectValue) return null
  while (operators.length > 0) {
    if (operators[operators.length - 1] === '(') return null
    if (!applyTop()) return null
  }
  if (values.length !== 1) return null
  return Number.isFinite(values[0]) ? values[0] : null
}
