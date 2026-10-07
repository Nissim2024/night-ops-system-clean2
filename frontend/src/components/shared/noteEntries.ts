// QC Notes/dev-comments parsing — see renderNotesField in defectFieldDisplay.tsx.
const NOTE_ENTRY_HEADER_RE = /^\s*(.+?)\s*<([^<>]+)>\s*,\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*:\s*/;
// The same header ANYWHERE in a chunk (user report 2026-10-06: an entry
// written without the underscore separator showed its header in the middle
// of the previous entry, aligned right with the Hebrew text). Names are
// matched as 1-4 Latin words so Hebrew text before a mid-line header isn't
// swallowed into the name.
const NOTE_HEADER_ANYWHERE_RE = /([A-Za-z][A-Za-z.'\-]*(?:[ \t]+[A-Za-z][A-Za-z.'\-]*){0,3})[ \t]*<([^<>\s]+)>[ \t]*,[ \t]*(\d{1,2}\/\d{1,2}\/\d{2,4})[ \t]*:/g;

// ── Readable layout of a comment body (user, 2026-10-07) ─────────────────
// QC stores dev-comments hard-wrapped at a fixed width, so sentences arrive
// broken across lines ("Account is having open\nfreeze work order"). Display
// only — no character of the text is dropped or changed, only whitespace:
//  • a line that doesn't end a sentence (. ! ? : ;) is joined to the next
//    line with a space,
//  • unless the next line starts something of its own: a numbered / bulleted
//    item, an "11010 - …" code line, a shell prompt or command, a CSV/data
//    row, an SQL statement — those keep their line,
//  • data / code lines never swallow the line after them,
//  • blank lines are paragraph breaks (runs collapse to one).
const LIST_ITEM_RE = /^(\d{1,3}[.)]|[-•*–]|\(?[א-ת][.)])\s/;
// "11010 - Account…", "11014 No active…" (a number then a word — not "12265, …")
const CODE_LINE_RE = /^\d{3,}(\s*-\s|\s+[A-Za-z֐-׿])/;
// a short section label: "CRM: …", "EAI: …", "הערה: …"
const LABEL_LINE_RE = /^[A-Za-z֐-׿][\w֐-׿ .'"/-]{0,24}:\s/;
const SQL_RE = /^(select|update|insert|delete|from|where|and|or|order by|group by)\b/i;
const SHELL_RE = /(^[~/][\w./-]*)|(\S+:\[[^\]]*\][^>]*>)|(^\$\s)/;
// CSV / data row: many commas and few spaces (prose has a space after each comma)
const isCsvRow = (l: string) => {
  const commas = (l.match(/,/g) ?? []).length;
  return commas >= 5 && (l.match(/ /g) ?? []).length <= commas / 2;
};
const isDataLine = (l: string) => isCsvRow(l) || SHELL_RE.test(l);
const startsOwnLine = (l: string) => LIST_ITEM_RE.test(l) || CODE_LINE_RE.test(l) || LABEL_LINE_RE.test(l) || SQL_RE.test(l) || isDataLine(l);

// HTML entities left in QC text (found on real production defects, 2026-10-07):
// "&nbsp;", double-encoded "&amp;nbsp;", and a broken form whose ";" became
// ">" ("&nbsp>", "&lt>ksenian&gt>") — ~130k of them across 8,681 defects. The
// ">"/";" terminator is consumed with the entity, so "&lt>login&gt>" becomes
// "<login>" again (which is also what lets the comment headers be recognised).
// An entity cut in half by the 4000-byte list limit ("…&nbs") is dropped.
export function decodeNoteEntities(text: string): string {
  let t = text;
  for (let i = 0; i < 3 && /&(amp|nbsp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+)/i.test(t); i++) {
    t = t
      .replace(/&amp[;>]?/gi, '&')
      .replace(/&nbsp[;>]?/gi, ' ')
      .replace(/&lt[;>]?/gi, '<')
      .replace(/&gt[;>]?/gi, '>')
      .replace(/&quot[;>]?/gi, '"')
      .replace(/&(apos|#39)[;>]?/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return t.replace(/&(n|nb|nbs|g|l|q|qu|quo|a|am)$/i, '');
}

export const TRAILING_HTML_FRAGMENT_RE = /<\/?(div|span|font|p|br|b|i|u|a|html|body|table|tr|td|strong|em|li|ul|ol)\b[^<>\n]{0,200}$/i;

export function reflowNoteText(text: string): string {
  // a list query's 4000-byte cut can end inside an HTML tag ("<div align=…"):
  // drop only that unclosed markup fragment at the very end
  // — only a known HTML tag on the last line; anything else that merely starts
  // with "<" (XML payloads, a header missing its ">") is real content and stays
  text = text.replace(TRAILING_HTML_FRAGMENT_RE, '');
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim());
  const paragraphs: string[] = [];
  let cur: string[] = [];
  const flush = () => { if (cur.length) paragraphs.push(cur.join('\n')); cur = []; };
  for (const line of lines) {
    if (!line) { flush(); continue; }
    if (cur.length === 0) { cur.push(line); continue; }
    const prev = cur[cur.length - 1];
    const prevEnds = /[.!?:;]$/.test(prev);
    if (/^[.,;:!?)]+$/.test(line)) { cur[cur.length - 1] = prev + line; continue; }   // a stray "." on its own line
    if (prevEnds || isDataLine(prev) || startsOwnLine(line)) cur.push(line);
    else cur[cur.length - 1] = `${prev} ${line}`;
  }
  flush();
  return paragraphs.join('\n\n');
}

export interface NoteEntry { header: string | null; body: string; dayKey: number; seq: number }

// One entry per comment — split on the underscore runs AND on every header —
// sorted oldest → newest (user, 2026-10-06). QC headers carry a date only
// (D/M/YYYY, no time), so same-day entries keep QC's own order; text with no
// header (legacy, before the first comment) stays first.
export function parseNoteEntries(raw: string | null | undefined): NoteEntry[] {
  const out: NoteEntry[] = [];
  let seq = 0;
  const dayKeyOf = (d: string) => {
    const [dd, mm, yy] = d.split('/').map(Number);
    const y = yy < 100 ? 2000 + yy : yy;
    return y * 10000 + mm * 100 + dd;
  };
  for (const chunk of decodeNoteEntities(raw ?? '').split(/_{5,}/).map(c => c.trim()).filter(Boolean)) {
    const matches = Array.from(chunk.matchAll(NOTE_HEADER_ANYWHERE_RE));
    if (matches.length === 0) {
      const m = chunk.match(NOTE_ENTRY_HEADER_RE);   // non-Latin name at the very start
      if (m) out.push({ header: `${m[1]} <${m[2]}>, ${m[3]}:`, body: reflowNoteText(chunk.slice(m[0].length)), dayKey: dayKeyOf(m[3]), seq: seq++ });
      else out.push({ header: null, body: reflowNoteText(chunk), dayKey: -1, seq: seq++ });
      continue;
    }
    const lead = chunk.slice(0, matches[0].index).trim();
    if (lead) out.push({ header: null, body: reflowNoteText(lead), dayKey: -1, seq: seq++ });
    matches.forEach((m, k) => {
      const from = (m.index ?? 0) + m[0].length;
      const to = k + 1 < matches.length ? matches[k + 1].index : chunk.length;
      out.push({ header: `${m[1].trim()} <${m[2]}>, ${m[3]}:`, body: reflowNoteText(chunk.slice(from, to)), dayKey: dayKeyOf(m[3]), seq: seq++ });
    });
  }
  return out.sort((a, b) => (a.dayKey - b.dayKey) || (a.seq - b.seq));
}

