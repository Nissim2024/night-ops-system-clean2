import { appendQcComment, qcCommentSignature, QC_COMMENT_SEPARATOR } from './qc-comment-entry';
import { getAllowedTransitionsForUser } from './qc-workflow-transitions';

const D = new Date(2024, 3, 3, 15, 42); // 03/04/2024 15:42 local

describe('QC-format comment (2026-10-07)', () => {
  it('signature: "Full Name <login>, dd/mm/yyyy:" — date only, no time', () => {
    expect(qcCommentSignature('Yossi Siton', 'yossis', D)).toBe('Yossi Siton <yossis>, 03/04/2024:');
  });

  it('plain text: separator + signature, text on the next line, appended after everything', () => {
    const cur = 'Ksenia Nazarov <ksenian>, 20/03/2024:\nCR 11257';
    expect(appendQcComment(cur, 'Yossi Siton', 'yossis', 'נבדק שוב\nתוקן', D))
      .toBe(`${cur}\n${QC_COMMENT_SEPARATOR}Yossi Siton <yossis>, 03/04/2024:\nנבדק שוב\nתוקן`);
  });

  it('empty field: just the entry', () => {
    expect(appendQcComment('', 'A B', 'ab', 'x', D)).toBe(`${QC_COMMENT_SEPARATOR}A B <ab>, 03/04/2024:\nx`);
  });

  it('HTML field: entry added as HTML before </body>, text escaped, old content untouched', () => {
    const cur = '<html><body><div>old &lt;b&gt;</div></body></html>';
    const out = appendQcComment(cur, 'Yossi Siton', 'yossis', 'a < b\nשורה 2', D);
    expect(out.startsWith('<html><body><div>old &lt;b&gt;</div>')).toBe(true);
    expect(out.endsWith('</body></html>')).toBe(true);
    expect(out).toContain('<b>Yossi Siton &lt;yossis&gt;, 03/04/2024:</b>');
    expect(out).toContain('a &lt; b<br />שורה 2');
    expect(out).toContain(QC_COMMENT_SEPARATOR);
  });
});

describe('status lifecycle by role (2026-10-07)', () => {
  it('ADMIN / RELEASE_MANAGER: every group\'s transitions + Pending', () => {
    const a = getAllowedTransitionsForUser('ADMIN', [], 'Fixed_Test');
    expect(a.hasMapping).toBe(true);
    expect(a.allowed).toEqual(expect.arrayContaining(['Reopen', 'Closed', 'Pending']));
    expect(getAllowedTransitionsForUser('RELEASE_MANAGER', [], 'New').allowed).toContain('Pending');
  });

  it('nobody else can move to Pending', () => {
    for (const g of ['QATesters_New', 'Developer_New', 'HotSupport']) {
      for (const s of ['New', 'Open', 'At Work', 'Fixed_Dev', 'Fixed_Test', 'Reopen', 'Rejected', 'Closed', 'Canceled']) {
        expect(getAllowedTransitionsForUser('TEAM_LEAD', [g], s).allowed.map(x => x.toLowerCase())).not.toContain('pending');
      }
    }
  });

  it('CR_MANAGER gets the developers\' rules even without a mapped team', () => {
    const r = getAllowedTransitionsForUser('CR_MANAGER', [], 'Reopen');
    expect(r.hasMapping).toBe(true);
    expect(r.allowed).toEqual(expect.arrayContaining(['Fixed_Dev', 'Rejected', 'At Work']));
  });

  it('a user whose team is not mapped gets no list (status locked)', () => {
    expect(getAllowedTransitionsForUser('EMPLOYEE', [], 'Open')).toEqual({ hasMapping: false, allowed: [] });
  });

  it('QA tester from Fixed_Test: Reopen or Closed only', () => {
    expect(getAllowedTransitionsForUser('EMPLOYEE', ['QATesters_New'], 'Fixed_Test').allowed.sort()).toEqual(['Closed', 'Reopen']);
  });
});

import { listItemValues } from './qc-rest.service';

// Real Project-Lists shape (production dump 2026-09-23): the value is the
// "value" attribute, tree lists nest Items.
describe('listItemValues', () => {
  it('reads @_value (flat list)', () => {
    expect(listItemValues([{ '@_value': 'Checked_In' }, { '@_value': 'Checked_Out' }])).toEqual(['Checked_In', 'Checked_Out']);
  });
  it('walks a tree list in order, no duplicates', () => {
    const items = [{ '@_value': '2016 Releases', Item: [{ '@_value': 'V1-2016', Item: { '@_value': '2142 - לא לחייב' } }] }, { '@_value': 'V1-2016' }];
    expect(listItemValues(items)).toEqual(['2016 Releases', 'V1-2016', '2142 - לא לחייב']);
  });
  it('a single item (not an array)', () => {
    expect(listItemValues({ '@_value': 'Y' })).toEqual(['Y']);
  });
});

// Paired release/cycle fields + detection-field roles (2026-10-08)
jest.mock('./qc.service', () => ({
  getQcPersonDirectory: jest.fn(async () => []),
  getReleaseCycleOptions: jest.fn(async () => [
    { id: '347', name: 'ITv01-2024', startDate: null, inFlight: false, cycles: [{ id: '1073', name: 'Cycle 1', startDate: null }] },
    { id: '378', name: 'ITv07-2026', startDate: null, inFlight: true, cycles: [{ id: '1305', name: 'Cycle 2', startDate: null }] },
  ]),
}));
import { QcRestService } from './qc-rest.service';

describe('release/cycle pairs', () => {
  const svc: any = new (QcRestService as any)();
  it('accepts a cycle of the chosen release, and "no cycle"', async () => {
    await expect(svc.validateRefPairs({ detectedInRelease: { id: '347', label: 'ITv01-2024' }, detectedInCycle: { id: '1073', label: 'Cycle 1' } })).resolves.toBeUndefined();
    await expect(svc.validateRefPairs({ targetRelease: { id: '378', label: 'ITv07-2026' }, targetCycle: { id: '', label: '' } })).resolves.toBeUndefined();
  });
  it('refuses a cycle of another release', async () => {
    await expect(svc.validateRefPairs({ detectedInRelease: { id: '347', label: 'ITv01-2024' }, detectedInCycle: { id: '1305', label: 'Cycle 2' } }))
      .rejects.toThrow('לא שייך לגרסה ITv01-2024');
  });
  it('refuses half a pair and an unknown release', async () => {
    await expect(svc.validateRefPairs({ targetCycle: { id: '1305', label: 'Cycle 2' } })).rejects.toThrow('מתעדכנים יחד');
    await expect(svc.validateRefPairs({ targetRelease: { id: '999', label: 'X' }, targetCycle: { id: '', label: '' } })).rejects.toThrow('לא נמצאה');
  });
  it('Detected By / on Date: editable for ADMIN and RELEASE_MANAGER only', () => {
    expect(svc.getEditableDefectFieldKeys('ADMIN').fields).toEqual(expect.arrayContaining(['detectedBy', 'detectedOnDate']));
    expect(svc.getEditableDefectFieldKeys('RELEASE_MANAGER').fields).toContain('detectedBy');
    expect(svc.getEditableDefectFieldKeys('TEAM_LEAD').fields).not.toContain('detectedBy');
    expect(svc.getEditableDefectFieldKeys('EMPLOYEE').fields).not.toContain('detectedOnDate');
    expect(svc.getEditableDefectFieldKeys('ADMIN').refFields).toEqual(['detectedInRelease', 'detectedInCycle', 'targetRelease', 'targetCycle']);
  });
});

import { parseQcError } from './qc-rest.service';

// QC refusing a write because someone has the defect open (2026-10-09)
describe('parseQcError', () => {
  it('recognises a lock refusal and who holds it', () => {
    const e = parseQcError(`<QCRestException><Id>qccore.lock-failure</Id><Title>Failed to update entity: The entity is locked by user 'yakovc'</Title></QCRestException>`);
    expect(e.isLock).toBe(true);
    expect(e.lockUser).toBe('yakovc');
  });
  it('a lock refusal without a user name is still a lock', () => {
    expect(parseQcError('<QCRestException><Id>qccore.entity-locked</Id><Title>Entity is locked</Title></QCRestException>').isLock).toBe(true);
  });
  it('other refusals: readable title, not a lock', () => {
    const e = parseQcError('<QCRestException><Id>qccore.required-field-missing</Id><Title>Required field Severity is missing</Title></QCRestException>');
    expect(e).toMatchObject({ isLock: false, title: 'Required field Severity is missing' });
  });
});

// Unified create form (2026-10-09): QC's Required fields are checked first
jest.mock('./qc-project-context', () => ({
  assertQcProjectWritable: jest.fn(async () => undefined),
  currentQcProject: jest.fn(async () => null),
  projectParamKey: jest.fn(async (k: string) => k),
}));
describe('createDefectFromForm — required fields', () => {
  const svc: any = new (QcRestService as any)();
  svc.resolveQcLogin = async () => 'nissimp';
  svc.resolveFullName = async () => 'Nissim P';
  svc.createDefectRaw = jest.fn(async () => ({ id: '70001', raw: {}, postStatus: 201 }));
  it('names every missing required field, creates nothing', async () => {
    await expect(svc.createDefectFromForm({ title: '', fields: { severity: 'Low' } }, 'u1'))
      .rejects.toThrow(/Summary.*Priority.*Detected in Release.*Environment.*Responsibility.*Project.*CR\/HBR.*Comments/);
    expect(svc.createDefectRaw).not.toHaveBeenCalled();
  });
  it('Detected By / on Date default to the creator and today', async () => {
    svc.translateTier2Fields = jest.fn(async (f: any) => f);
    svc.translateTier2RefFields = jest.fn(async (f: any) => f);
    svc.validateRefPairs = jest.fn(async () => undefined);
    await svc.createDefectFromForm({
      title: 'x', comment: 'נמצא בבדיקה',
      fields: { severity: 'Low', priority: 'Low', environment: 'Test', responsibility: 'CRM Team', system: 'Wizard', crHbrNumberReference: '12714 - x' },
      refFields: { detectedInRelease: { id: '347', label: 'ITv01-2024' }, detectedInCycle: { id: '1073', label: 'Cycle 1' } },
    }, 'u1');
    const sent = svc.translateTier2Fields.mock.calls[0][0];
    expect(sent.detectedBy).toBe('nissimp');
    expect(sent.detectedOnDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const payload = svc.createDefectRaw.mock.calls[0][0];
    expect(payload['dev-comments']).toContain('Nissim P <nissimp>');
  });
});

import { listItemTree } from './qc-rest.service';
// QC tree lists keep who is under whom (2026-10-09: CRs under their release)
describe('listItemTree', () => {
  it('keeps the release → CR nesting', () => {
    const items = [{ '@_value': '2026 Releases', Item: [{ '@_value': 'ITv07-2026', Item: [{ '@_value': '12902 - x' }, { '@_value': '12917 - y' }] }] }, { '@_value': 'Regression', Item: { '@_value': 'CRM Regression' } }];
    const t = listItemTree(items);
    expect(t.map(n => n.value)).toEqual(['2026 Releases', 'Regression']);
    expect(t[0].children[0].value).toBe('ITv07-2026');
    expect(t[0].children[0].children.map(n => n.value)).toEqual(['12902 - x', '12917 - y']);
    expect(t[1].children[0].value).toBe('CRM Regression');
  });
});
