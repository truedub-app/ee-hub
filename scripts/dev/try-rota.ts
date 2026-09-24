// Dev helper: run the rota importer against a spreadsheet and print the plan summary.
import { readFileSync } from 'node:fs'
import { readWorkbook, workbookGrids } from '../../src/lib/xlsxGrid.ts'
import { buildPlan, detectLayout } from '../../src/features/rota/import/parseRota.ts'
import { DEFAULT_CODES, DEFAULT_SECTIONS } from '../../src/data/defaults.ts'

const file = process.argv[2]
const wb = readWorkbook(readFileSync(file))
for (const grid of workbookGrids(wb)) {
  const layout = detectLayout(grid, DEFAULT_SECTIONS)
  if (!layout) { console.log(grid.sheet, 'no layout'); continue }
  if (layout.kind === 'wide') for (const b of layout.blocks) console.log('block', b.label, '→', b.section || '(infer)', 'rows', b.rowStart, b.rowEnd, 'dates', b.columns.filter(c => c.role === 'date').length)
  const plan = buildPlan(grid, layout, { sections: DEFAULT_SECTIONS, codes: DEFAULT_CODES, staff: [] })
  console.log(plan.period, plan.stats)
  for (const n of plan.names) console.log(' ', n.display.padEnd(34), n.section.padEnd(10), n.sectionInferred ? 'inferred' : '', n.suspicious ?? '')
  for (const w of plan.warnings) console.log(`[${w.level}] ${w.message}`)
  const codes: Record<string, number> = {}
  for (const c of plan.cells) codes[c.code] = (codes[c.code] ?? 0) + 1
  console.log(codes)
}
