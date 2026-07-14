// Some text fields (Description/Comments/Notes, especially anything sourced
// from QC/HP-ALM rich-text fields) arrive containing raw HTML entities
// (&nbsp; &quot; &lt; &gt;) and/or HTML tags (<span>, <div>, <p>...) instead
// of plain text. Decoding via the browser's own parser (innerHTML → textContent)
// handles every entity correctly, not just a hand-picked few, and strips tags
// as a side effect — safer and more complete than a regex/entity-map.
export function cleanHtmlText(raw: string | null | undefined): string {
  if (!raw) return '';
  if (!/[&<>]/.test(raw)) return raw; // fast path: no entities/tags present
  const el = document.createElement('div');
  el.innerHTML = raw;
  const text = el.textContent ?? el.innerText ?? '';
  // Collapse whitespace runs (including long &nbsp; chains) into single spaces.
  return text.replace(/\s+/g, ' ').trim();
}
