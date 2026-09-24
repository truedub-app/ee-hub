/** Read spreadsheet files (xlsx, xls, csv, ods) into plain grids with SheetJS, keeping cell fill colours. */
import * as XLSX from 'xlsx'
import type { Grid } from '../features/rota/import/parseRota'

export function readWorkbook(data: ArrayBuffer | Uint8Array): XLSX.WorkBook {
  return XLSX.read(data, { type: 'array', cellDates: false, cellText: true, cellStyles: true, dense: false })
}

export function sheetGrid(wb: XLSX.WorkBook, name: string): Grid {
  const ws = wb.Sheets[name]
  const ref = ws?.['!ref']
  if (!ws || !ref) return { sheet: name, rows: [], rowOffset: 0, colOffset: 0 }
  const range = XLSX.utils.decode_range(ref)
  // Built cell by cell: with cellStyles on, sheet_to_json(raw) drops text cells that carry a date number format.
  const rows: (string | number | boolean | null)[][] = []
  // Solid fill colour per cell as 'RRGGBB' — the department marks In-Charge cells in yellow.
  const fills: (string | null)[][] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: (string | number | boolean | null)[] = []
    const fillRow: (string | null)[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as (XLSX.CellObject & { s?: { patternType?: string; fgColor?: { rgb?: string } } }) | undefined
      const v = cell && (cell.t === 's' || cell.t === 'n' || cell.t === 'b') ? (cell.v as string | number | boolean) : null
      row.push(v)
      const rgb = cell?.s?.patternType === 'solid' ? cell.s.fgColor?.rgb : undefined
      fillRow.push(rgb ? rgb.toUpperCase().slice(-6) : null)
    }
    rows.push(row)
    fills.push(fillRow)
  }
  return { sheet: name, rows, fills, rowOffset: range.s.r, colOffset: range.s.c }
}

export function workbookGrids(wb: XLSX.WorkBook): Grid[] {
  return wb.SheetNames.map((n) => sheetGrid(wb, n))
}
