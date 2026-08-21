import { describe, expect, it } from 'vitest'
import {
  aggregationPartIdOf,
  buildCheckSheet,
  toCheckSheetTsv,
  type CheckSheetSourceItem
} from '../../src/core/aggregate/checkSheet'

const PARTS = [
  { id: 1, name: '床' },
  { id: 2, name: '巾木' },
  { id: 3, name: '壁' },
  { id: 6, name: '天井' }
]

function item(source: Partial<CheckSheetSourceItem>): CheckSheetSourceItem {
  return {
    part1: '1階',
    part2: '事務室',
    materialCategory: '仕上',
    partNumber: 10,
    partName: '床',
    name: 'ビニル床シート',
    quantity: 10,
    ...source
  }
}

describe('チェック表', () => {
  it('部位番号の10の位から管理用部位を決める', () => {
    expect(aggregationPartIdOf(10)).toBe(1)
    expect(aggregationPartIdOf(23)).toBe(2)
    expect(aggregationPartIdOf(205)).toBe(20)
    expect(aggregationPartIdOf(null)).toBe(null)
    expect(aggregationPartIdOf(5)).toBe(null)
  })

  it('部位Ⅰ・部位Ⅱ・管理用部位・名称で数量を合算する', () => {
    const sheet = buildCheckSheet(
      [
        item({}),
        item({ quantity: 5 }),
        item({ partNumber: 20, partName: '巾木', name: 'ソフト巾木', quantity: 12.5 }),
        item({ part2: '会議室', partNumber: 30, partName: '壁', name: 'ＥＰ塗装' })
      ],
      PARTS,
      '仕上'
    )
    expect(sheet.parts.map((part) => part.name)).toEqual(['床', '巾木', '壁'])
    expect(sheet.blocks).toHaveLength(2)
    expect(sheet.blocks[0].columns[0]).toEqual([{ name: 'ビニル床シート', quantity: 15 }])
    expect(sheet.blocks[0].columns[1]).toEqual([{ name: 'ソフト巾木', quantity: 12.5 }])
    expect(sheet.blocks[0].columns[2]).toEqual([])
    expect(sheet.blocks[1].part2).toBe('会議室')
  })

  it('材種区分が違う明細は含めない', () => {
    const sheet = buildCheckSheet([item({ materialCategory: '軸組' })], PARTS, '仕上')
    expect(sheet.blocks).toHaveLength(0)
  })

  it('部位番号が無い明細は部位名から管理用部位を探す', () => {
    const sheet = buildCheckSheet(
      [item({ partNumber: null, partName: '室名天井', name: '岩綿吸音板' })],
      PARTS,
      '仕上'
    )
    expect(sheet.parts.map((part) => part.name)).toEqual(['天井'])
  })

  it('Excel貼り付け用に余白の列と空行を残す', () => {
    const sheet = buildCheckSheet(
      [item({}), item({ part2: '会議室', partNumber: 60, partName: '天井', name: '化粧石膏' })],
      PARTS,
      '仕上'
    )
    const lines = toCheckSheetTsv(sheet).split('\n')
    expect(lines[0].split('\t')).toEqual(['部位', '', '', '床', '', '', '', '天井', '', '', ''])
    expect(lines[1].split('\t')).toEqual([
      '部位Ⅰ',
      '部位Ⅱ',
      '',
      '名称',
      '',
      '数量',
      '',
      '名称',
      '',
      '数量',
      ''
    ])
    expect(lines[2].split('\t')).toEqual([
      '1階',
      '事務室',
      '',
      'ビニル床シート',
      '',
      '10.00',
      '',
      '',
      '',
      '',
      ''
    ])
    expect(lines[3]).toBe('')
    expect(lines[4].split('\t')[7]).toBe('化粧石膏')
  })
})
