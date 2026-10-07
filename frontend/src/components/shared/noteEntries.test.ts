import { parseNoteEntries, reflowNoteText } from './noteEntries';

// Comments field parsing (user report 2026-10-06: a header showed up on the
// right, inside the previous comment, and comments weren't in date order).
describe('parseNoteEntries', () => {
  it('splits on underscore separators and sorts oldest → newest', () => {
    const raw = '________\nDana Cohen <danac>, 12/5/2026: שני\n________\nLimor Kalchuk <limork>, 10/5/2026: ראשון';
    const e = parseNoteEntries(raw);
    expect(e.map(x => x.body)).toEqual(['ראשון', 'שני']);
    expect(e[0].header).toBe('Limor Kalchuk <limork>, 10/5/2026:');
  });

  it('splits a header that appears mid-text without a separator', () => {
    const raw = 'Limor Kalchuk <limork>, 10/5/2026: בוצעה בדיקה Dana Cohen <danac>, 11/5/2026: תוקן';
    const e = parseNoteEntries(raw);
    expect(e).toHaveLength(2);
    expect(e[0].body).toBe('בוצעה בדיקה');
    expect(e[1].header).toBe('Dana Cohen <danac>, 11/5/2026:');
    expect(e[1].body).toBe('תוקן');
  });

  it('keeps same-day entries in their original order and legacy text first', () => {
    const raw = 'טקסט ישן\n________\nB B <b>, 1/2/2026: second\n________\nA A <a>, 1/2/2026: third';
    const e = parseNoteEntries(raw);
    expect(e.map(x => x.body)).toEqual(['טקסט ישן', 'second', 'third']);
    expect(e[0].header).toBeNull();
  });

  it('reads D/M/YYYY (10/5 is May 10, before 2/6)', () => {
    const raw = 'X Y <x>, 2/6/2026: june\n________\nX Y <x>, 10/5/2026: may';
    expect(parseNoteEntries(raw).map(x => x.body)).toEqual(['may', 'june']);
  });
});

// Readable layout (user, 2026-10-07) — samples shaped like real QC dev-comments.
describe('reflowNoteText', () => {
  it('joins a sentence QC hard-wrapped mid-way', () => {
    expect(reflowNoteText('בוצעה בדיקה של השירות ValidateOpenWO\r\n וגם של הממשק. \r\nשורה חדשה.'))
      .toBe('בוצעה בדיקה של השירות ValidateOpenWO וגם של הממשק.\nשורה חדשה.');
  });

  it('keeps code lines on their own line but joins their wrapped tails', () => {
    const raw = '11009 - Account is having open \r\nfreeze work order\r\n11010 - Account is having open \r\nCN/CH/DS work order\r\n11011 - Account is suspended';
    expect(reflowNoteText(raw)).toBe('11009 - Account is having open freeze work order\n11010 - Account is having open CN/CH/DS work order\n11011 - Account is suspended');
  });

  it('keeps numbered items, paragraphs and a stray dot', () => {
    const raw = '1. בדיקה ב EAI - נמצא שהשירות מחזיר שגיאה ב reporting \r\n . \r\n\r\n2. בדיקה ב CRM';
    expect(reflowNoteText(raw)).toBe('1. בדיקה ב EAI - נמצא שהשירות מחזיר שגיאה ב reporting.\n\n2. בדיקה ב CRM');
  });

  it('never merges shell prompts or CSV rows', () => {
    const raw = 'הקובץ נראה כך - \r\n\r\nhot-wizapp-prod:[wizapp]~/data/out> vi rep.csv\r\n903,62414340,1,INT,2,IN,22/07/2020\r\n904,62414340,0,INT,2,IN,22/07/2020';
    expect(reflowNoteText(raw)).toBe('הקובץ נראה כך -\n\nhot-wizapp-prod:[wizapp]~/data/out> vi rep.csv\n903,62414340,1,INT,2,IN,22/07/2020\n904,62414340,0,INT,2,IN,22/07/2020');
  });

  it('keeps every word — only whitespace changes', () => {
    const raw = 'לפי CR \r\n 12265, הבעיה נגרמת \r\nבגלל ההקפאה \r\n\r\n\r\nסוף';
    const out = reflowNoteText(raw);
    expect(out).toBe('לפי CR 12265, הבעיה נגרמת בגלל ההקפאה\n\nסוף');
    expect(out.replace(/\s+/g, '')).toBe(raw.replace(/\s+/g, ''));
  });

  it('codes without a dash and section labels start their own line; comma-heavy prose still joins', () => {
    const raw = '11011 - Account is suspended\r\n11014 No active RF account\r\nCRM: לפני הקריאה, ולאחר הולידציות, יש לבדוק, ולוודא, שהלקוח פעיל, ובמידה ולא פעיל בקטגוריה \r\nאינטרנט, לא נבצע קריאה.';
    expect(reflowNoteText(raw)).toBe('11011 - Account is suspended\n11014 No active RF account\nCRM: לפני הקריאה, ולאחר הולידציות, יש לבדוק, ולוודא, שהלקוח פעיל, ובמידה ולא פעיל בקטגוריה אינטרנט, לא נבצע קריאה.');
  });

  it('keeps XML / a header without ">" — "<" alone is not markup to drop', () => {
    expect(reflowNoteText('בקשה: <ht1:CaseHeader class="R" xmlns:ht1="x"')).toBe('בקשה: <ht1:CaseHeader class="R" xmlns:ht1="x"');
  });

  it('drops only an unclosed HTML fragment left by the list cut', () => {
    expect(reflowNoteText('טקסט אחרון \r\n<div align="right" dir="rt')).toBe('טקסט אחרון');
  });
});
