// Dev helper: run the contacts importer against a spreadsheet and print the result.
import { readFileSync } from 'node:fs'
import { readWorkbook, workbookGrids } from '../../src/lib/xlsxGrid.ts'
import { parseContacts } from '../../src/features/contacts/parseContacts.ts'

const wb = readWorkbook(readFileSync(process.argv[2]))
const res = parseContacts(workbookGrids(wb)[0], Date.now())!
for (const c of res.contacts) console.log(c.kind.padEnd(6), c.team.padEnd(22), (c.subTeam ?? '').padEnd(34), c.name.padEnd(30), (c.jobTitle ?? '').padEnd(40), c.channels.join('|'), c.extension ?? '', c.email ?? '')
console.log(res.fixes)
