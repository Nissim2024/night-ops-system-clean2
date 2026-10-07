// A new comment written from DeployCenter, in QC's own comment format (user,
// 2026-10-07): the separator line, then the "Full Name <login>, dd/mm/yyyy:"
// signature QC's "add comment" button writes (date only, no time), then the
// text on the next line. Appended to the FULL current value read from QC at
// save time, so nothing someone else added in the meantime is overwritten.
//
// QC keeps dev-comments as HTML when the field was ever edited in QC's rich
// editor, and as plain text otherwise. HTML values get the entry as HTML in
// the shape QC's own editor produces (bold separator + signature, text with
// <br>); plain values get plain text. The exact markup QC 11 uses here is
// UNVERIFIED against this instance — it only needs to render as the same
// separator / signature / text in QC, which both forms do.

export const QC_COMMENT_SEPARATOR = '________________________________________';

export function qcCommentDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function qcCommentSignature(fullName: string, login: string, d: Date = new Date()): string {
  return `${fullName.trim()} <${login.trim()}>, ${qcCommentDate(d)}:`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const isHtmlComment = (v: string) => /<\s*(html|body|div|p|br|font|span|b)\b/i.test(v);

export function appendQcComment(current: string, fullName: string, login: string, note: string, d: Date = new Date()): string {
  const text = note.replace(/\r\n?/g, '\n').trim();
  const signature = qcCommentSignature(fullName, login, d);
  const cur = current ?? '';
  if (isHtmlComment(cur)) {
    const entry =
      `<div align="left"><font face="Arial"><span style="font-size:8pt"><br /></span></font></div>` +
      `<div align="left"><font face="Arial" color="#000080"><span style="font-size:8pt"><b>${QC_COMMENT_SEPARATOR}</b></span></font></div>` +
      `<div align="left"><font face="Arial" color="#000080"><span style="font-size:8pt"><b>${esc(signature)}</b></span></font>` +
      `<font face="Arial"><span style="font-size:8pt"><br />${esc(text).replace(/\n/g, '<br />')}</span></font></div>`;
    return /<\/body>/i.test(cur) ? cur.replace(/<\/body>/i, `${entry}</body>`) : cur + entry;
  }
  const block = `${QC_COMMENT_SEPARATOR}${signature}\n${text}`;
  return cur.trim() ? `${cur.replace(/\s+$/, '')}\n${block}` : block;
}
