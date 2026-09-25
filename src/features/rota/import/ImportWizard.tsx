import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CircleCheck, CloudUpload, FileSpreadsheet, Info, KeyRound, RotateCcw, TriangleAlert, Undo2, Upload } from 'lucide-react'
import type { WorkBook } from 'xlsx'
import { useHub, usePerms } from '../../../data/store'
import type { ImportRecord } from '../../../data/types'
import { readWorkbook, sheetGrid } from '../../../lib/xlsxGrid'
import { mediumDate, shortDay } from '../../../lib/dates'
import { uid, plural } from '../../../lib/text'
import { Badge, Empty, Notice, cx } from '../../../ui/primitives'
import { toast } from '../../../ui/toast'
import { PageHead } from '../../shell/Shell'
import { applyPlan, buildPlan, colName, defaultDecision, detectLayout, planDays, type ColumnRole, type Grid, type Layout, type NameDecision } from './parseRota'
import { rollbackImport } from './rollback'
import { PublishProgress, PublisherSetup, usePublishRunner } from '../../admin/PublishPanel'
import '../rota.css'

type Step = 'file' | 'map' | 'preview' | 'done'

const ROLE_OPTIONS: { value: ColumnRole; label: string }[] = [
  { value: 'name', label: 'Employee name' },
  { value: 'employeeId', label: 'Employee ID' },
  { value: 'section', label: 'Section' },
  { value: 'date', label: 'Date / shift code' },
  { value: 'code', label: 'Shift code' },
  { value: 'hours', label: 'Shift hours' },
  { value: 'duty', label: 'Duty role' },
  { value: 'ignore', label: '— Ignore —' },
]

function Steps({ step }: { step: Step }) {
  const all: [Step, string][] = [['file', 'Select file'], ['map', 'Map columns'], ['preview', 'Validate & preview'], ['done', 'Imported']]
  const at = all.findIndex(([s]) => s === step)
  return (
    <ol className="row-wrap" style={{ listStyle: 'none', padding: 0, margin: '0 0 18px', gap: 6 }} aria-label="Import steps">
      {all.map(([s, l], i) => (
        <li key={s} className={cx('badge lg', i < at ? 'tone-qc2' : i === at ? 'tone-accent' : 'tone-muted')} aria-current={i === at ? 'step' : undefined}>
          {i < at ? '✓' : i + 1} · {l}
        </li>
      ))}
    </ol>
  )
}

export function ImportWizard() {
  const perms = usePerms()
  const navigate = useNavigate()
  const data = useHub((s) => s.data)
  const actor = useHub((s) => s.local.userName ?? s.session?.label ?? 'Unknown')
  const [step, setStep] = useState<Step>('file')
  const [fileName, setFileName] = useState('')
  const [wb, setWb] = useState<WorkBook>()
  const [sheet, setSheet] = useState('')
  const [layout, setLayout] = useState<Layout | null>(null)
  const [mappings, setMappings] = useState<Record<string, string>>({})
  const [remember, setRemember] = useState(true)
  const [decisions, setDecisions] = useState<Record<string, NameDecision>>({})
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<ImportRecord>()
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  // after an import, send it to every device straight away (one-click publishing)
  const publisher = useHub((s) => s.local.publisher)
  const pub = usePublishRunner()
  const [setupPublishing, setSetupPublishing] = useState(false)

  const sections = data.sections.filter((s) => !s.deleted)
  const codes = data.shiftCodes.filter((c) => !c.deleted)
  const staff = data.staff.filter((s) => !s.deleted)

  const grid: Grid | undefined = useMemo(() => (wb && sheet ? sheetGrid(wb, sheet) : undefined), [wb, sheet])
  const plan = useMemo(
    () => (grid && layout ? buildPlan(grid, layout, { sections, codes, staff, mappings }) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, layout, mappings, data.sections, data.shiftCodes, data.staff],
  )

  if (!perms.importRota) {
    return <Empty icon={<FileSpreadsheet />} title="Import is restricted">Only department managers and administrators can import the rota.</Empty>
  }

  const load = async (file: File) => {
    setError(undefined)
    try {
      const buf = await file.arrayBuffer()
      const book = readWorkbook(buf)
      // choose the sheet with the most date headers
      let best = book.SheetNames[0]
      let bestScore = -1
      for (const n of book.SheetNames) {
        const l = detectLayout(sheetGrid(book, n), sections)
        const score = !l ? 0 : l.kind === 'wide' ? l.blocks.reduce((a, b) => a + b.columns.filter((c) => c.role === 'date').length, 0) : 5
        if (score > bestScore) {
          best = n
          bestScore = score
        }
      }
      setWb(book)
      setFileName(file.name)
      setSheet(best)
      setLayout(detectLayout(sheetGrid(book, best), sections))
      setMappings({})
      setDecisions({})
      setStep('map')
    } catch (e) {
      setError(`Could not read this file: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const changeSheet = (name: string) => {
    if (!wb) return
    setSheet(name)
    setLayout(detectLayout(sheetGrid(wb, name), sections))
  }

  const setBlockSection = (i: number, section: string) => {
    if (layout?.kind !== 'wide') return
    setLayout({ ...layout, blocks: layout.blocks.map((b, k) => (k === i ? { ...b, section } : b)) })
  }
  const setColumnRole = (blockIdx: number, col: number, role: ColumnRole) => {
    if (!layout) return
    if (layout.kind === 'wide') {
      setLayout({
        ...layout,
        blocks: layout.blocks.map((b, k) => (k !== blockIdx ? b : { ...b, columns: b.columns.map((c) => (c.col === col ? { ...c, role: role === 'date' && !c.date ? 'ignore' : role } : c)) })),
      })
    } else setLayout({ ...layout, columns: layout.columns.map((c) => (c.col === col ? { ...c, role } : c)) })
  }

  const confirm = () => {
    if (!plan) return
    const st = useHub.getState()
    const importId = uid('imp-')
    const now = Date.now()
    const res = applyPlan(plan, decisions, st.data, { importId, actor, now })
    // remember mappings for unrecognised entries as import aliases on the chosen codes
    if (remember && Object.keys(mappings).length) {
      const byCode = new Map<string, string[]>()
      for (const [text, code] of Object.entries(mappings)) byCode.set(code, [...(byCode.get(code) ?? []), `^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`])
      st.upsert('shiftCodes', [...byCode.entries()].map(([code, rx]) => {
        const c = st.data.shiftCodes.find((x) => x.code === code)!
        return { ...c, match: [...(c.match ?? []), ...rx], updatedAt: now }
      }))
    }
    const record: ImportRecord = {
      id: importId, kind: 'rota', fileName, importedBy: actor, importedAt: now, updatedAt: now, period: plan.period,
      stats: { ...plan.stats, created: res.counts.created, updated: res.counts.updated, unchanged: res.counts.unchanged, skipped: res.counts.skipped, newStaff: res.counts.newStaff },
      warnings: plan.warnings.map((w) => `${w.level === 'info' ? 'ℹ' : '⚠'} ${w.message}`),
      before: res.before, beforeDuties: res.beforeDuties,
    }
    if (res.staff.length) st.upsert('staff', res.staff)
    if (res.rota.length) st.upsert('rota', res.rota)
    if (res.duties.length) st.upsert('duties', res.duties)
    st.upsert('imports', [record])
    st.setLocal({ lastDataAt: now, lastDataSource: `Rota import — ${fileName}` })
    st.audit('rota.import', fileName, `${res.counts.created + res.counts.updated} cells updated, ${res.counts.newStaff} new staff`)
    setResult(record)
    setStep('done')
    if (perms.admin && st.local.publisher) void pub.run()
  }

  // ---------------------------------------------------------------------------------------
  return (
    <div style={{ maxWidth: 1180 }}>
      <PageHead
        title="Import ROTA"
        sub="Import the official Excel rota. Nothing changes until you confirm — every import can be rolled back."
        actions={<button className="btn" onClick={() => navigate('/admin/imports')}>Import history</button>}
      />
      <Steps step={step} />

      {step === 'file' && (
        <div className="col" style={{ gap: 14 }}>
          <div
            className="card"
            style={{ padding: 36, borderStyle: 'dashed', borderWidth: 2, borderColor: drag ? 'var(--accent)' : 'var(--line-2)', textAlign: 'center', background: drag ? 'var(--accent-soft)' : undefined }}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              const f = e.dataTransfer.files[0]
              if (f) void load(f)
            }}
          >
            <div className="col" style={{ alignItems: 'center', gap: 12 }}>
              <div className="empty-icon" style={{ width: 64, height: 64, borderRadius: 18, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-2)' }}>
                <FileSpreadsheet width={30} height={30} />
              </div>
              <h2>Drop the rota spreadsheet here</h2>
              <p className="muted small">Excel (.xlsx, .xls), OpenDocument (.ods) or CSV. The file is read on this device only.</p>
              <button className="btn btn-primary btn-lg" onClick={() => inputRef.current?.click()}><Upload /> Select Excel file</button>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
            </div>
          </div>
          {error && <Notice tone="alert">{error}</Notice>}
          <Notice icon={<Info />}>
            The importer understands the department’s block layout (Morning / Afternoon / Night blocks with one column per day, cells such as <span className="mono">08 till 16 00</span>, <span className="mono">OFF</span>, <span className="mono">missing list &amp; QC 2</span>, <span className="mono">Holiday</span>, <span className="mono">toil</span>; <strong>yellow cells mark the In-Charge</strong>) as well as simple tables with Name / Date / Shift columns.
          </Notice>
        </div>
      )}

      {step === 'map' && wb && (
        <div className="col" style={{ gap: 16 }}>
          <div className="card card-pad col" style={{ gap: 12 }}>
            <div className="row-wrap" style={{ gap: 12 }}>
              <FileSpreadsheet style={{ color: 'var(--qc2)' }} />
              <strong>{fileName}</strong>
              <span className="spacer" />
              <label className="field-label" htmlFor="sheet">Worksheet</label>
              <select id="sheet" className="select" style={{ width: 'auto' }} value={sheet} onChange={(e) => changeSheet(e.target.value)}>
                {wb.SheetNames.map((n) => <option key={n} value={n}>{n.trim() || n}</option>)}
              </select>
            </div>
            {!layout && <Notice tone="alert">No rota layout detected on this sheet — no row with at least three dates, and no Name / Date / Shift header. Try another worksheet.</Notice>}
            {layout?.kind === 'wide' && <p className="small muted">Detected <strong>{plural(layout.blocks.length, 'block')}</strong> with dates across the columns. Check each block’s section and the column roles below.</p>}
            {layout?.kind === 'long' && <p className="small muted">Detected a table with one row per staff member and day. Map each column to an app field.</p>}
          </div>

          {layout?.kind === 'wide' && layout.blocks.map((b, i) => {
            const dateCols = b.columns.filter((c) => c.role === 'date')
            const other = b.columns.filter((c) => c.role !== 'date' && (c.header || c.role !== 'ignore'))
            return (
              <div key={i} className="card">
                <div className="card-head">
                  <span className="eyebrow">Block {i + 1} · row {b.headerRow + (grid?.rowOffset ?? 0) + 1}</span>
                  <strong style={{ marginRight: 'auto' }}>“{b.label}”</strong>
                  <label className="field-label" htmlFor={`sec-${i}`}>Section</label>
                  <select id={`sec-${i}`} className="select" style={{ width: 'auto' }} value={b.section} onChange={(e) => setBlockSection(i, e.target.value)}>
                    <option value="">Infer from shifts</option>
                    {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="card-body col" style={{ gap: 12 }}>
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Excel column</th><th>Header</th><th>App field</th></tr></thead>
                      <tbody>
                        {other.map((c) => (
                          <tr key={c.col}>
                            <td className="mono">{colName(c.col + (grid?.colOffset ?? 0))}</td>
                            <td>{c.header || <span className="faint">(empty)</span>}</td>
                            <td>
                              <select className="select" value={c.role} onChange={(e) => setColumnRole(i, c.col, e.target.value as ColumnRole)} aria-label={`Field for column ${colName(c.col)}`}>
                                {ROLE_OPTIONS.filter((o) => o.value !== 'date' && o.value !== 'code' && o.value !== 'hours').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td className="mono">{colName(dateCols[0].col + (grid?.colOffset ?? 0))}–{colName(dateCols[dateCols.length - 1].col + (grid?.colOffset ?? 0))}</td>
                          <td>{dateCols[0].header} … {dateCols[dateCols.length - 1].header}</td>
                          <td><Badge tone="qc2">✓ {dateCols.length} date columns → Shift code</Badge> <span className="small faint">{mediumDate(dateCols[0].date!)} – {mediumDate(dateCols[dateCols.length - 1].date!)}</span></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          })}

          {layout?.kind === 'long' && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Excel column</th><th>Header</th><th>App field</th></tr></thead>
                <tbody>
                  {layout.columns.filter((c) => c.header).map((c) => (
                    <tr key={c.col}>
                      <td className="mono">{colName(c.col + (grid?.colOffset ?? 0))}</td>
                      <td>{c.header}</td>
                      <td>
                        <select className="select" value={c.role} onChange={(e) => setColumnRole(0, c.col, e.target.value as ColumnRole)}>
                          {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label === 'Date / shift code' ? 'Date' : o.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="row">
            <button className="btn" onClick={() => setStep('file')}><ArrowLeft /> Back</button>
            <span className="spacer" />
            <button className="btn btn-primary" disabled={!plan || plan.stats.cells === 0} onClick={() => setStep('preview')}>Validate <ArrowRight /></button>
          </div>
        </div>
      )}

      {step === 'preview' && plan && (
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head"><h2>Import summary</h2><span className="spacer" /><span className="small muted">{fileName} · {sheet.trim()}</span></div>
            <div className="card-body col" style={{ gap: 8 }}>
              <SummaryLine ok text={`${plan.stats.staff} staff records found`} />
              <SummaryLine ok text={`${plan.stats.days} schedule days found (${mediumDate(plan.period.from)} – ${mediumDate(plan.period.to)})`} />
              <SummaryLine ok text={`${plan.stats.cells} shift cells processed · ${plan.stats.qc2} QC 2 duties`} />
              {plan.stats.inCharge > 0 ? <SummaryLine ok text={`${plan.stats.inCharge} In-Charge assignments (yellow cells)`} /> : <SummaryLine text="No yellow In-Charge cells found — assign In-Charge on the duty board" />}
              {plan.names.filter((n) => n.status !== 'matched').length > 0 && staff.length > 0 && <SummaryLine text={`${plan.names.filter((n) => n.status !== 'matched').length} unknown staff names — choose below`} />}
              {plan.stats.duplicates > 0 && <SummaryLine text={plural(plan.stats.duplicates, 'duplicate')} />}
              {plan.names.filter((n) => n.sectionInferred).length > 0 && <SummaryLine text={`${plan.names.filter((n) => n.sectionInferred).length} missing section values (inferred)`} />}
              {plan.stats.unknown > 0 && <SummaryLine alert text={`${plan.stats.unknown} unrecognised entries — map them below`} />}
              <details style={{ marginTop: 6 }}>
                <summary className="small" style={{ cursor: 'pointer', color: 'var(--text-2)' }}>All notes ({plan.warnings.length})</summary>
                <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-2)' }}>
                  {plan.warnings.map((w, i) => <li key={i} style={{ color: w.level === 'warn' ? 'var(--warn)' : undefined }}>{w.message}</li>)}
                </ul>
              </details>
            </div>
          </div>

          {plan.unknown.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Unrecognised entries</h2></div>
              <div className="card-body col" style={{ gap: 10 }}>
                <p className="small muted">These cells are not silently discarded. Map each text to a code, or leave it as “Unrecognised” to fix later.</p>
                {plan.unknown.map((u) => (
                  <div key={u.text} className="row-wrap">
                    <span className="mono" style={{ minWidth: 180 }}>“{u.text}”</span>
                    <span className="small faint">×{u.count} · {u.where.join(', ')}</span>
                    <span className="spacer" />
                    <select className="select" style={{ width: 240 }} value={mappings[u.text.toLowerCase()] ?? ''} onChange={(e) => setMappings({ ...mappings, [u.text.toLowerCase()]: e.target.value })}>
                      <option value="">Leave as unrecognised</option>
                      {codes.filter((c) => c.code !== 'X').map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
                    </select>
                  </div>
                ))}
                <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember these mappings for future imports</label>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head"><h2>Staff</h2><span className="spacer" /><span className="small muted">{plan.names.length} names</span></div>
            <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="table">
                <thead><tr><th>Name in file</th><th>Section</th><th>Match</th><th>Action</th></tr></thead>
                <tbody>
                  {plan.names.map((n) => {
                    const d = decisions[n.key] ?? defaultDecision(n)
                    return (
                      <tr key={n.key}>
                        <td>
                          <strong>{n.display}</strong>
                          {n.suspicious && <div className="tiny" style={{ color: 'var(--warn)' }}>⚠ {n.suspicious}</div>}
                        </td>
                        <td>{sections.find((s) => s.id === n.section)?.name}{n.sectionInferred && <span className="tiny faint"> (inferred)</span>}</td>
                        <td>
                          {n.status === 'matched' && <Badge tone="qc2">✓ Existing</Badge>}
                          {n.status === 'suggested' && <Badge tone="warn">Similar: {n.suggestion?.name}</Badge>}
                          {n.status === 'new' && <Badge tone="accent">New</Badge>}
                        </td>
                        <td>
                          <select
                            className="select"
                            value={d.action === 'map' ? `map:${d.staffId}` : d.action}
                            onChange={(e) => {
                              const v = e.target.value
                              setDecisions({ ...decisions, [n.key]: v.startsWith('map:') ? { action: 'map', staffId: v.slice(4) } : { action: v as 'create' | 'skip' } })
                            }}
                            aria-label={`Action for ${n.display}`}
                          >
                            <option value="create">Create new staff record</option>
                            <option value="skip">Skip (don’t import)</option>
                            {staff.length > 0 && <optgroup label="Map to existing">{staff.map((s) => <option key={s.id} value={`map:${s.id}`}>{s.name}</option>)}</optgroup>}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <PreviewGrid plan={plan} />

          <div className="row" style={{ position: 'sticky', bottom: 12, zIndex: 5 }}>
            <button className="btn" onClick={() => setStep('map')}><ArrowLeft /> Back</button>
            <span className="spacer" />
            <button className="btn btn-primary btn-lg" onClick={confirm}><CircleCheck /> Confirm import</button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="card card-pad col" style={{ gap: 14, alignItems: 'flex-start' }}>
          <Badge tone="qc2" lg>✓ Import complete</Badge>
          <h2>{result.fileName}</h2>
          <p className="muted">
            {result.stats.created + result.stats.updated} cells updated ({result.stats.created} new, {result.stats.updated} changed, {result.stats.unchanged} unchanged)
            {result.stats.newStaff ? ` · ${plural(result.stats.newStaff, 'new staff record')}` : ''} · imported by {result.importedBy}.
          </p>
          <div className="col" style={{ gap: 10, width: '100%', maxWidth: 620 }}>
            <strong className="row" style={{ gap: 8 }}><CloudUpload width={18} style={{ color: 'var(--accent-2)' }} /> Every device</strong>
            {perms.admin && publisher ? (
              <>
                <PublishProgress state={pub.state} />
                {pub.state.error && <div><button className="btn btn-sm" onClick={() => void pub.run()}><RotateCcw /> Try again</button></div>}
              </>
            ) : perms.admin ? (
              <Notice tone="warn" action={<button className="btn btn-sm" onClick={() => setSetupPublishing(true)}><KeyRound /> Set up</button>}>
                <strong>Only this device has the new rota so far.</strong> Set up one-click publishing once — this rota is then sent to every device, and future imports go out automatically.
              </Notice>
            ) : (
              <Notice tone="warn">Only this device has the new rota so far. Ask an administrator to publish it to every device.</Notice>
            )}
          </div>
          {setupPublishing && <PublisherSetup onClose={() => setSetupPublishing(false)} onSaved={() => void pub.run()} />}
          <div className="row-wrap">
            <button className="btn btn-primary" onClick={() => navigate(`/rota?date=${result.period?.from ?? ''}`)}>View rota</button>
            <button className="btn" onClick={() => navigate('/admin/imports')}>Import history</button>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                if (await rollbackImport(result.id)) {
                  toast('Import rolled back')
                  navigate('/rota')
                }
              }}
            >
              <Undo2 /> Undo this import
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryLine({ text, ok, alert }: { text: string; ok?: boolean; alert?: boolean }) {
  return (
    <div className="row" style={{ gap: 10, color: ok ? 'var(--text)' : alert ? 'var(--alert)' : 'var(--warn)' }}>
      {ok ? <CircleCheck width={18} style={{ color: 'var(--qc2)' }} /> : <TriangleAlert width={18} />}
      <span>{text}</span>
    </div>
  )
}

function PreviewGrid({ plan }: { plan: NonNullable<ReturnType<typeof buildPlan>> }) {
  const codes = useHub((s) => s.data.shiftCodes)
  const days = planDays(plan)
  const byKey = new Map<string, Map<string, (typeof plan.cells)[number]>>()
  for (const c of plan.cells) {
    const m = byKey.get(c.key) ?? new Map()
    m.set(c.date, c)
    byKey.set(c.key, m)
  }
  return (
    <div className="card">
      <div className="card-head"><h2>Preview</h2><span className="spacer" /><span className="small muted">What will be written to the rota</span></div>
      <div className="grid-wrap month" style={{ border: 0, borderRadius: 0, maxHeight: 520 }}>
        <table className="rgrid">
          <thead>
            <tr>
              <th className="staff-col">Staff</th>
              {days.map((d) => <th key={d}><span className="dname">{shortDay(d).split(' ')[0]}</span><span className="dnum">{d.slice(8)}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {plan.names.map((n) => (
              <tr key={n.key}>
                <th className="staff-col"><div className="staff-cell"><span className="nm">{n.display}</span></div></th>
                {days.map((d) => {
                  const c = byKey.get(n.key)?.get(d)
                  const code = codes.find((x) => x.code === c?.code)
                  const kind = code?.kind
                  return (
                    <td key={d}>
                      <span className={cx('rcell', `tone-${c?.code === 'Q' ? 'qc2' : code?.tone ?? 'unassigned'}`, kind === 'rest' && 'rest', kind === 'absence' && 'absence', c?.code === 'X' && 'unknown', c?.code === 'Q' && 'qc', c?.inferred && 'inferred')} title={c ? `${c.where}: “${c.raw}”${c.inferred ? ` — ${c.inferred}` : ''}` : ''}>
                        <span className="code">{c ? code?.glyph ?? c.code : ''}</span>
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
