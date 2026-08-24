import { describe, expect, it } from 'vitest'
import {
  detailAsTsv,
  duplicateDetail,
  duplicateSet,
  fillLines,
  pasteDetails,
  pasteLines,
  setAsTsv
} from '../../src/core/room/calcClipboard'
import { calcDetail, calcLine, calcSet } from '../../src/core/room/calcSheet'

describe('セット明細計算表のコピー・貼り付け', () => {
  it('Excelの表を明細として取り込む（足りない行は追加する）', () => {
    const details = [calcDetail(), calcDetail()]
    const text = ['床\tビニル床シート\t上\t下\tm2\t1.05\t備上\t備下\tC21', '\tモルタル下地'].join('\n')
    const next = pasteDetails(details, 0, text)
    expect(next).toHaveLength(2)
    expect(next[0].name).toBe('ビニル床シート')
    expect(next[0].partName).toBe('床')
    expect(next[0].unit).toBe('m2')
    expect(next[0].coefficient).toBe(1.05)
    expect(next[0].estimateDisplay).toBe('C21')
    expect(next[1].name).toBe('モルタル下地')
    // 掛け率が空欄なら元の値のまま
    expect(next[1].coefficient).toBe(1)
  })

  it('選んだ明細の位置から貼り付け、行数が足りなければ増やす', () => {
    const details = [calcDetail({ name: '元' })]
    const next = pasteDetails(details, 1, 'A\t追加1\nB\t追加2')
    expect(next.map((row) => row.name)).toEqual(['元', '追加1', '追加2'])
  })

  it('Excelの数量表を計算式として取り込む（1列だけなら計算式Ａ）', () => {
    const lines = [calcLine({ bSymbol: 'B1' })]
    const next = pasteLines(lines, 0, '3*4.5\n12.30')
    expect(next.map((row) => row.formulaA)).toEqual(['3*4.5', '12.30'])
    // 記号Ｂはセットに1つなので貼り付けでは動かさない
    expect(next[0].bSymbol).toBe('B1')

    const three = pasteLines([calcLine()], 0, '廊下\t2*3\t1.2')
    expect(three[0]).toMatchObject({ comment: '廊下', formulaA: '2*3', formulaB: '1.2' })
  })

  it('全角の数字・桁区切りは半角へ直して取り込む', () => {
    const next = pasteLines([calcLine()], 0, '\t１２．５\t2')
    expect(next[0].formulaA).toBe('12.5')
    const details = pasteDetails([calcDetail()], 0, '床\t名称\t\t\tm2\t１.５')
    expect(details[0].coefficient).toBe(1.5)
  })

  it('明細を増やしたら計算式行も1明細1行になるまで足す', () => {
    const details = [calcDetail(), calcDetail(), calcDetail()]
    const lines = [calcLine({ formulaA: '1' }), calcLine()]
    const next = fillLines(details, lines)
    expect(next).toHaveLength(3)
    expect(next[0].formulaA).toBe('1')
    // すでに足りているときは増やさない
    expect(fillLines([calcDetail()], next)).toHaveLength(3)
  })

  it('明細・セットはExcelへ貼れるTSVでコピーする', () => {
    const detail = calcDetail({ partName: '床', name: 'シート', unit: 'm2', coefficient: 1.05 })
    expect(detailAsTsv(detail).split('\t').slice(0, 3)).toEqual(['床', 'シート', ''])

    const set = calcSet(0)
    set.partName = '床'
    set.details = [detail]
    set.lines = [calcLine({ formulaA: '3*4', comment: '事務室' })]
    const rows = setAsTsv(set).split('\r\n')
    expect(rows).toHaveLength(1)
    expect(rows[0].split('\t')[0]).toBe('床')
    expect(rows[0].split('\t')[7]).toBe('3*4')
  })

  it('写した明細・セットは新しいIDを持ち、記号Ｂは引き継がない', () => {
    const detail = calcDetail({ name: 'シート' })
    const copied = duplicateDetail(detail)
    expect(copied.id).not.toBe(detail.id)
    expect(copied.name).toBe('シート')

    const set = calcSet(0)
    set.partName = '床'
    set.details = [detail]
    set.lines = [calcLine({ formulaA: '3*4', bSymbol: 'B1' })]
    const copiedSet = duplicateSet(set)
    expect(copiedSet.id).not.toBe(set.id)
    expect(copiedSet.partName).toBe('床')
    expect(copiedSet.details[0].id).not.toBe(detail.id)
    expect(copiedSet.lines[0].formulaA).toBe('3*4')
    expect(copiedSet.lines[0].bSymbol).toBe('')
  })
})
