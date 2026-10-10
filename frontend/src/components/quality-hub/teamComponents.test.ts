import { teamComponentsFor, TeamEnvComponents } from './OpenProdDefectsView';

// Environment Component options follow the Responsibility team (user, 2026-10-10)
describe('teamComponentsFor', () => {
  const data: TeamEnvComponents = {
    teams: [
      { name: 'NETC Team', responsibility: 'NETC-DT team', components: ['BILI'] },
      { name: 'CRM Dev Team', responsibility: null, components: ['CRM'] },
      { name: 'Web Dev Team', responsibility: null, components: [] },
    ],
    all: ['BILI', 'CRM', 'DWH', 'WEB-HOT', 'ZOO-CMDB'],
    history: { 'oss team': ['ZOO-CMDB', 'TOP'], 'hot design team': ['WEB-HOT', 'CRM'], 'crm team': ['CRM', 'TOP'] },
  };
  it('the systems set for the team (by its QC Responsibility link) first, then what its defects used', () => {
    expect(teamComponentsFor(data, 'NETC-DT team')).toEqual(['BILI']);
    expect(teamComponentsFor(data, 'CRM Team')).toEqual(['CRM', 'TOP']);
  });
  it('matches a team by a loose name ("CRM Team" ~ "CRM Dev Team")', () => {
    expect(teamComponentsFor({ ...data, history: {} }, 'CRM Team')).toEqual(['CRM']);
  });
  it('falls back to what the team\'s defects used in QC', () => {
    expect(teamComponentsFor(data, 'OSS Team')).toEqual(['ZOO-CMDB', 'TOP']);
  });
  it('several teams ("A;B") → the union, without repeats', () => {
    expect(teamComponentsFor(data, 'NETC-DT team; HOT Design Team')).toEqual(['BILI', 'WEB-HOT', 'CRM']);
  });
  it('unknown team / empty → [] (the form offers the full list)', () => {
    expect(teamComponentsFor(data, 'Nobody Team')).toEqual([]);
    expect(teamComponentsFor(data, '')).toEqual([]);
    expect(teamComponentsFor(null, 'OSS Team')).toEqual([]);
  });
});
