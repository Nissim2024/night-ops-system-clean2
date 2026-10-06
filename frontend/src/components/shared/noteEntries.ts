// QC Notes/dev-comments parsing — see renderNotesField in defectFieldDisplay.tsx.
const NOTE_ENTRY_HEADER_RE = /^\s*(.+?)\s*<([^<>]+)>\s*,\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*:\s*/;
// The same header ANYWHERE in a chunk (user report 2026-10-06: an entry
// written without the underscore separator showed its header in the middle
// of the previous entry, aligned right with the Hebrew text). Names are
// matched as 1-4 Latin words so Hebrew text before a mid-line header isn't
// swallowed into the name.
const NOTE_HEADER_ANYWHERE_RE = /([A-Za-z][A-Za-z.'\-]*(?:[ \t]+[A-Za-z][A-Za-z.'\-]*){0,3})[ \t]*<([^<>\s]+)>[ \t]*,[ \t]*(\d{1,2}\/\d{1,2}\/\d{2,4})[ \t]*:/g;

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
  for (const chunk of (raw ?? '').split(/_{5,}/).map(c => c.trim()).filter(Boolean)) {
    const matches = Array.from(chunk.matchAll(NOTE_HEADER_ANYWHERE_RE));
    if (matches.length === 0) {
      const m = chunk.match(NOTE_ENTRY_HEADER_RE);   // non-Latin name at the very start
      if (m) out.push({ header: `${m[1]} <${m[2]}>, ${m[3]}:`, body: chunk.slice(m[0].length).trim(), dayKey: dayKeyOf(m[3]), seq: seq++ });
      else out.push({ header: null, body: chunk, dayKey: -1, seq: seq++ });
      continue;
    }
    const lead = chunk.slice(0, matches[0].index).trim();
    if (lead) out.push({ header: null, body: lead, dayKey: -1, seq: seq++ });
    matches.forEach((m, k) => {
      const from = (m.index ?? 0) + m[0].length;
      const to = k + 1 < matches.length ? matches[k + 1].index : chunk.length;
      out.push({ header: `${m[1].trim()} <${m[2]}>, ${m[3]}:`, body: chunk.slice(from, to).trim(), dayKey: dayKeyOf(m[3]), seq: seq++ });
    });
  }
  return out.sort((a, b) => (a.dayKey - b.dayKey) || (a.seq - b.seq));
}

