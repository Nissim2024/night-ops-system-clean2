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
