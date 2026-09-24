import { describe, expect, it } from 'vitest'
import { extractChannels, normaliseTeam, parseContacts } from './parseContacts'

describe('contacts import', () => {
  it('normalises teams and channels', () => {
    expect(normaliseTeam('MAM  -  Tech Ops')).toEqual({ team: 'Tech Ops', subTeam: 'MAM' })
    expect(normaliseTeam('schedulers').team).toBe('Scheduling & Planning')
    expect(normaliseTeam('TCR ( Transmission )').team).toBe('Transmission')
    expect(extractChannels('MBC DRAMA+')).toEqual(['MBC Drama+'])
    expect(extractChannels('MBC DRAMA, MBC DRAMA+')).toEqual(['MBC Drama+', 'MBC Drama'])
    expect(extractChannels('MBC4, MBC2, MAX, Vriety')).toEqual(['MBC 2', 'MBC 4', 'MBC Max', 'MBC Variety'])
  })

  it('finds the header row and repairs data-entry slips', () => {
    const res = parseContacts({
      sheet: 'Sheet1', rowOffset: 3, colOffset: 2,
      rows: [
        ['Team / Department ', 'Name ', 'Title ', 'Responsibility ', 'Ext', 'Email'],
        ['Turkish & TeleNovella Acquisition  ', 'Sample Person', 'Acquisition Assistant', 'Turkish & Foreign Content ', 3432, 'Sample.Person@example.com>'],
        ['MAM  -  Tech Ops', 'MAM', 'MAM', 'all related to ( DALET - Media Files - storage ) ', '-', 'Mam@example.com'],
        ['Planners', 'Other Person ', 'Planning Manager ( ARABIC ) ', 'Grid + weekly Plan', 2328, 'o.p@example.com'],
      ],
    }, 1)!
    expect(res.contacts).toHaveLength(3)
    expect(res.contacts[0].email).toBe('Sample.Person@example.com')
    expect(res.contacts[0].subTeam).toBe('Turkish & Telenovela Acquisition')
    expect(res.contacts[1].kind).toBe('group')
    expect(res.contacts[1].extension).toBeUndefined()
    expect(res.contacts[2].jobTitle).toBe('Planning Manager (Arabic)')
    expect(res.fixes.length).toBeGreaterThanOrEqual(2)
  })
})
