import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE, severityColor, severityBg, severityLabel } from '../../theme';
import { CyclesPanel, CycleProgress } from './CycleProgressView';
import { DefectDrilldownModal } from './DefectDrilldownModal';
import { KpiTile, RiskRow } from '../HomeDashboard';
import { DefectIdBadge } from '../shared/defectFieldDisplay';
import { formatDate } from '../../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

function isRm(r: string) { return ['RELEASE_MANAGER', 'ADMIN'].includes(r); }

// Email clients (Outlook's Word engine especially) don't render flexbox or
// CSS grid — a straight DOM clone of a flex/grid-based page collapses to one
// column. These two rebuild every such container as an HTML <table> (the one
// layout mechanism every client actually supports), preserving row/column
// arrangement, gap-as-padding, and alignment, so the pasted copy keeps the
// same side-by-side structure as the live page.
// 2, not 4 like the live screen: the table's row grouping (how many <td>s per
// <tr>) is baked into the HTML at copy time and can't reflow per-viewer like
// a real page — there's no JS running for someone reading the pasted email,
// and a `<style>` media query to shrink it on mobile wouldn't survive anyway
// (Gmail/Outlook's paste-into-compose sanitizer strips <style> blocks, which
// is the same reason this whole file rebuilds flex/grid as literal <table>s
// instead of relying on CSS). A fixed 2-column grid is the one layout that's
// legible on both a phone and a desktop reading pane without needing either.
const EMAIL_GRID_COLS = 2;
// The live FONT stack leads with 'Rubik' then system-ui/-apple-system — Outlook's
// Word engine can't resolve those tokens and falls back to Times New Roman, so
// the email came out serif. This stack is all real, widely-installed families.
const EMAIL_FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
// Light page ground behind the white cards — without it (a plain white email)
// the cards' thin borders don't read as cards, which is how the dashboard's
// grey app background reads in the real UI.
const EMAIL_PAGE_BG = '#f4f5f7';

// The flex/grid container itself often carries real decoration too — card
// background, border, border-radius, padding, position:relative (the anchor
// for an absolutely-positioned corner badge). Replacing it outright with a
// bare <table> silently drops all of that (and un-anchors any absolutely
// positioned child, which then floats relative to some ancestor further up
// and overlaps unrelated content). Strip only the flex/grid-specific
// properties and keep the rest on a wrapping <div> around the new table.
function nonLayoutStyle(style: string): string {
  return style
    .replace(/display:\s*(flex|grid);?/g, '')
    .replace(/flex-direction:\s*[\w-]+;?/g, '')
    .replace(/flex-wrap:\s*[\w-]+;?/g, '')
    .replace(/justify-content:\s*[\w-]+;?/g, '')
    .replace(/align-items:\s*[\w-]+;?/g, '')
    .replace(/grid-template-columns:[^;]+;?/g, '')
    .replace(/gap:\s*[\d.]+px;?/g, '');
}

// A "flex container with zero element children" isn't necessarily empty — a
// KpiTile icon chip (display:flex purely to self-center a single emoji) or
// CyclesPanel's countdown line (display:flex around a template-literal string)
// hold their entire content as bare TEXT nodes, which Array.from(el.children)
// never sees (.children is element-only). Discarding "childless" elements
// outright silently ate that text — every KpiTile icon and the countdown
// label were vanishing. Move every child NODE (text included) into the
// wrapper instead, and approximate flex's centering for a small fixed-size
// box (line-height == its own height) since display:flex itself is gone.
function preserveEmptyFlexLeaf(el: HTMLElement, wrapper: HTMLElement, style: string) {
  while (el.firstChild) wrapper.appendChild(el.firstChild);
  const centered = /justify-content:\s*center/.test(style) && /align-items:\s*center/.test(style);
  const heightM = style.match(/height:\s*(\d+)px/);
  if (centered && heightM) {
    wrapper.setAttribute('style', (wrapper.getAttribute('style') || '') + `;text-align:center;line-height:${heightM[1]}px;`);
  }
  el.replaceWith(wrapper);
}

function convertGridToTable(el: HTMLElement, _cols: number) {
  const children = Array.from(el.children) as HTMLElement[];
  const wrapper = document.createElement('div');
  wrapper.setAttribute('style', nonLayoutStyle(el.getAttribute('style') || ''));
  if (children.length === 0) { preserveEmptyFlexLeaf(el, wrapper, el.getAttribute('style') || ''); return; }
  const table = document.createElement('table');
  table.setAttribute('dir', 'rtl');
  table.setAttribute('role', 'presentation');
  table.setAttribute('width', '100%');
  table.setAttribute('cellpadding', '0');
  table.setAttribute('cellspacing', '0');
  table.setAttribute('border', '0');
  // One flat row, one <td> per card — the single structure Outlook's Word
  // engine renders reliably (spec 2026-09-06: "כל כרטיסיות הסבבים בשורה
  // אחת... כרטיסיות הסטטוס בשורה שנייה"). No row-chunking, no wrap. On a
  // wide desktop/Outlook pane the cards share the width evenly; on a phone
  // min-width keeps each card legible and the mail just scrolls sideways
  // (media-query stacking wouldn't survive Gmail's paste or Word anyway).
  table.style.cssText = 'border-collapse:collapse;width:100%;';
  const tr = document.createElement('tr');
  const w = Math.max(1, Math.round(100 / children.length));
  for (const child of children) {
    const td = document.createElement('td');
    td.style.cssText = `width:${w}%;min-width:150px;vertical-align:top;padding:6px;`;
    td.appendChild(child);
    tr.appendChild(td);
  }
  table.appendChild(tr);
  wrapper.appendChild(table);
  el.replaceWith(wrapper);
}

function convertFlexToTable(el: HTMLElement) {
  const style = el.getAttribute('style') || '';
  const children = Array.from(el.children) as HTMLElement[];
  const wrapStyle = nonLayoutStyle(style);
  // A flex container that carries a border or background IS a card — wrap it
  // in a <table><td> (not a <div>) so Outlook's Word engine actually paints
  // the fill + border. `mount` is what we drop the built inner table into and
  // then put back in place of the original element; `wrapper` is that outer
  // node.
  const isCard = /border|background/.test(wrapStyle);
  let wrapper: HTMLElement;
  let mount: HTMLElement;
  if (isCard) {
    const wt = document.createElement('table');
    wt.setAttribute('role', 'presentation');
    wt.setAttribute('width', '100%');
    wt.setAttribute('dir', 'rtl');
    wt.setAttribute('cellpadding', '0');
    wt.setAttribute('cellspacing', '0');
    wt.setAttribute('border', '0');
    wt.style.cssText = 'border-collapse:separate;width:100%';
    const wtr = document.createElement('tr');
    mount = document.createElement('td');
    mount.setAttribute('style', wrapStyle);
    wtr.appendChild(mount);
    wt.appendChild(wtr);
    wrapper = wt;
  } else {
    wrapper = document.createElement('div');
    wrapper.setAttribute('style', wrapStyle);
    mount = wrapper;
  }
  if (children.length === 0) {
    // empty leaf (icon chip etc.) — always a plain div, never a card
    const dv = document.createElement('div');
    dv.setAttribute('style', wrapStyle);
    preserveEmptyFlexLeaf(el, dv, style);
    return;
  }
  const isColumn = /flex-direction:\s*column/.test(style);
  const gapM = style.match(/gap:\s*([\d.]+)px/);
  const gap = gapM ? parseFloat(gapM[1]) : 0;
  const alignM = (style.match(/align-items:\s*([\w-]+)/) || [])[1];
  const valign = alignM === 'flex-end' ? 'bottom' : alignM === 'center' ? 'middle' : 'top';
  const spaceBetween = /justify-content:\s*space-between/.test(style);
  // A row is only a compact, shrink-to-fit-and-center cluster (KpiTile's own
  // internal icon+label / value rows) when it explicitly says so via
  // justify-content:center. Everything else — including a plain content row
  // with no justify-content at all, e.g. RiskRow's icon+text+badge line — is
  // meant to fill its parent, same as an ordinary flex row defaults to; giving
  // it the same shrink+center treatment is what made it read as "centered".
  const centered = /justify-content:\s*center/.test(style);

  const table = document.createElement('table');
  table.setAttribute('dir', 'rtl');
  table.setAttribute('role', 'presentation');
  table.setAttribute('cellpadding', '0');
  table.setAttribute('cellspacing', '0');
  table.setAttribute('border', '0');
  // max-width:100% on the shrink-wrap (margin:0 auto) branch matters once a
  // column gets narrow (2-col mobile grid): without it the table renders at
  // its natural content width and overflows past the card edge instead of
  // being capped — which is what a nowrap+ellipsis label inside it (e.g.
  // KpiTile's icon+moduleLabel row) actually needs in order to ellipsize at
  // all, since text-overflow only fires once something bounds the box.
  //
  // isColumn additionally gets table-layout:fixed — found live at the 2-col
  // mobile width: a KpiTile's vertical row-stack is exactly one column, but
  // with table-layout:auto a *width:100%* table is still only a floor, not a
  // ceiling — per the auto-table-layout algorithm, if any single row's own
  // min-content (e.g. the severity-bar row's nowrap labels/badges) exceeds
  // that 100%, the whole table grows to fit it, dragging every OTHER row in
  // the same card along — a card's whole "sub" text line ended up overflowing
  // past its own card's edge into the neighboring card even though nothing
  // about that particular line was too wide on its own. table-layout:fixed
  // makes width:100% a hard cap instead: an overlong nested row can still
  // overflow, but only itself, locally — it no longer stretches the card.
  // A short "label ↔ value" space-between row (the health-score breakdown,
  // the per-cycle QG targets) reads as one paired unit. In a wide card
  // (~630px) a full-width row flings the value to the far edge, ~500px from
  // its label — aligned in columns but detached. Cap those so the value
  // stays near its label; a header row (longer title … badge/arrow) keeps
  // full width so the title isn't squeezed. The cap hugs the RTL start (no
  // margin:auto) so the pair sits against the card's right edge.
  const isCompactPair = spaceBetween && children.length === 2
    && (children[0].textContent || '').trim().length <= 22
    && (children[children.length - 1].textContent || '').trim().length <= 22;
  table.style.cssText = 'border-collapse:collapse;' + (
    isColumn ? 'width:100%;table-layout:fixed;' :
    isCompactPair ? 'width:100%;max-width:300px;' :
    (spaceBetween || !centered) ? 'width:100%;' :
    'margin:0 auto;max-width:100%;'
  );

  if (isColumn) {
    children.forEach((child, i) => {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      if (i > 0 && gap) td.style.paddingTop = `${gap}px`;
      td.appendChild(child);
      tr.appendChild(td);
      table.appendChild(tr);
    });
  } else {
    const tr = document.createElement('tr');
    // A child the source page marked flex:1 (e.g. RiskRow's/a manual notice's
    // growing text column next to a fixed-size icon; or two equal-width stat
    // blocks like "CR-ים" / "תקלות שדווחו") is meant to absorb the width its
    // fixed-size siblings don't need. When every child in the row shares that
    // marker (an even split, not "one grows, the rest are fixed"), giving
    // each of them width:100% is invalid HTML — multiple 100%-width columns
    // in the same row — and browsers resolve it inconsistently; split the
    // 100% evenly across them instead.
    const growFlags = children.map(c => /\bflex:\s*1\b/.test(c.getAttribute('style') || ''));
    const growCount = growFlags.filter(Boolean).length;
    const evenSplit = growCount > 1;
    children.forEach((child, i) => {
      // space-between with a first + rest pattern (header rows: label …
      // arrow/button) — a full-width spacer cell pushes everything after it
      // to the far side. No explicit width on it: an empty cell with no
      // content already has zero min-content-width, so on a width:100% table
      // the layout engine gives it whatever's left AFTER the real (non-empty)
      // columns get their natural size — asking for width:100% on the cell
      // itself over-constrains the row and squeezes the real columns instead.
      if (i === 1 && spaceBetween) tr.appendChild(document.createElement('td'));
      const td = document.createElement('td');
      const widthStyle = !growFlags[i] ? '' : evenSplit ? `width:${Math.round(100 / growCount)}%;` : 'width:100%;';
      // Pin the two ends of a space-between row to their outer edges. The
      // whole KpiTile inherits text-align:center, and auto table-layout, when
      // the row is wider than its content, widens the label/value cells
      // rather than the (max-content:0) empty spacer between them — so a
      // centered label/value then floats mid-cell instead of hugging the card
      // edge, and consecutive rows with different-width values stop lining up
      // (QG's per-cycle target list, found live 2026-09-05). right = RTL
      // start, left = RTL end; physical values, not start/end, for old-client
      // safety — every one of these tables is dir="rtl".
      const alignStyle = spaceBetween
        ? (i === 0 ? 'text-align:right;' : i === children.length - 1 ? 'text-align:left;' : '')
        : '';
      // No blanket white-space:nowrap here — it's an inherited CSS property, so
      // it would force every descendant span/div to stop wrapping too (e.g. a
      // KpiTile's own multi-line label text), not just this cell's direct
      // content. Elements that actually need nowrap (short labels) already
      // carry it in their own inline style from the live page.
      td.style.cssText = `vertical-align:${valign};${widthStyle}${alignStyle}` + (i > 0 && !spaceBetween && gap ? `padding-inline-start:${gap}px;` : '');
      td.appendChild(child);
      tr.appendChild(td);
    });
    table.appendChild(tr);
  }
  mount.appendChild(table);
  el.replaceWith(wrapper);
}

// Root cause found 2026-09-17 (real screenshot of a pasted email: the top
// KPI ribbon survived intact, but the whole CyclesPanel/CycleCard grid below
// it pasted as bare unstyled stacked text — no card borders, no side-by-side
// layout, nothing). This file's OWN components (KpiTile, RiskRow's header)
// carry their display:flex/grid, border, background etc. as literal inline
// `style={{...}}` — visible to layoutToTables' and the color-flattening
// pass's `getAttribute('style')` regex matching below. CyclesPanel/CycleCard
// (CycleProgressView.tsx) were rebuilt in the Tailwind migration using
// `className="flex ... border ... bg-card"` instead — ALL of that lives in
// compiled Tailwind CSS classes, which never travel with a clipboard paste
// (only inline styles do) and were never inline to begin with, so this whole
// pipeline never even saw them as containers needing conversion.
//
// Fix: before layoutToTables runs, walk the LIVE tree (computed styles only
// resolve on an attached, laid-out element — the clone is detached) and bake
// the specific longhand properties the rest of this pipeline reads into
// literal inline style text on the CLONE's corresponding node (cloneNode(true)
// is a structural mirror, so the same querySelectorAll('*') order lines up
// 1:1). Skips any element that already carries its own inline `display:` —
// this file's already-tuned inline-style components are left byte-for-byte
// unchanged; only the gap left by Tailwind-only elements is filled.
const TAILWIND_SNAPSHOT_PROPS: [string, keyof CSSStyleDeclaration][] = [
  ['display', 'display'], ['flex-direction', 'flexDirection'], ['gap', 'gap'],
  ['justify-content', 'justifyContent'], ['align-items', 'alignItems'],
  ['border-top-width', 'borderTopWidth'], ['border-top-style', 'borderTopStyle'], ['border-top-color', 'borderTopColor'],
  ['border-width', 'borderWidth'], ['border-style', 'borderStyle'], ['border-color', 'borderColor'],
  ['border-radius', 'borderRadius'], ['background-color', 'backgroundColor'],
  ['padding-top', 'paddingTop'], ['padding-bottom', 'paddingBottom'], ['padding-left', 'paddingLeft'], ['padding-right', 'paddingRight'],
  ['color', 'color'], ['font-size', 'fontSize'], ['font-weight', 'fontWeight'], ['text-align', 'textAlign'], ['line-height', 'lineHeight'],
];
function snapshotTailwindStyles(liveRoot: HTMLElement, cloneRoot: HTMLElement) {
  const liveEls = liveRoot.querySelectorAll<HTMLElement>('*');
  const cloneEls = cloneRoot.querySelectorAll<HTMLElement>('*');
  liveEls.forEach((liveEl, i) => {
    const cloneEl = cloneEls[i];
    if (!cloneEl) return;
    const existingStyle = cloneEl.getAttribute('style') || '';
    if (/display\s*:/.test(existingStyle)) return; // already inline-styled — untouched
    const cs = getComputedStyle(liveEl);
    const isLayoutContainer = cs.display === 'flex' || cs.display === 'grid';
    const hasVisibleBorder = cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none';
    const hasBackground = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
    if (!isLayoutContainer && !hasVisibleBorder && !hasBackground) return; // plain text node wrapper — nothing to gain
    const parts = TAILWIND_SNAPSHOT_PROPS.map(([cssProp, jsProp]) => {
      const value = String(cs[jsProp] ?? '');
      if (!value || value === 'none' || value === 'normal' || value === '0px' || value === 'rgba(0, 0, 0, 0)') return '';
      return `${cssProp}:${value}`;
    }).filter(Boolean).join(';');
    if (parts) cloneEl.setAttribute('style', existingStyle ? `${existingStyle};${parts}` : parts);
  });
}

// Runs the grid pass then the flex pass over a static snapshot of the tree —
// nodes are moved (not copied) into the new tables, so a later pass still
// finds them via root.contains(). NOT el.isConnected: `root` (the clone) is
// never attached to `document`, so isConnected is false for every node in it
// from the start, regardless of any conversion — it only tracks attachment to
// a Document, not membership in this detached working tree.
function layoutToTables(root: HTMLElement) {
  const all = Array.from(root.querySelectorAll<HTMLElement>('*'));
  for (const el of all) {
    if (!root.contains(el)) continue;
    if (/display:\s*grid/.test(el.getAttribute('style') || '')) convertGridToTable(el, EMAIL_GRID_COLS);
  }
  for (const el of all) {
    if (!root.contains(el)) continue;
    if (/display:\s*flex/.test(el.getAttribute('style') || '')) convertFlexToTable(el);
  }
}

// oklch(L C H) → #rrggbb. Done by hand rather than via getComputedStyle
// because not every browser build resolves oklch in computed styles (some
// hand it back verbatim), and the whole point is to emit something Word can
// read. Standard Oklab→linear-sRGB matrix + sRGB gamma. Cached per string.
const _colorCache = new Map<string, string>();
function resolveModernColor(fn: string): string {
  const cached = _colorCache.get(fn);
  if (cached) return cached;
  let out = '#4b5563';
  const m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/i.exec(fn);
  if (m) {
    const L = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    const C = parseFloat(m[2]);
    const H = (parseFloat(m[3]) * Math.PI) / 180;
    const a = C * Math.cos(H), b = C * Math.sin(H);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3, mm = m_ ** 3, s = s_ ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
    ];
    const hex = lin.map(c => {
      const g = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
      return Math.max(0, Math.min(255, Math.round(g * 255))).toString(16).padStart(2, '0');
    }).join('');
    out = `#${hex}`;
  }
  _colorCache.set(fn, out);
  return out;
}

// Every colour Outlook's Word engine can't parse — oklch/lab/lch (the
// theme's module colour is oklch), color-mix(), and functional-alpha
// rgba() — flattened to a plain hex/rgb. Word silently drops an
// unrecognised colour, which is a big part of why the card accents, tints
// and muted greys vanish there and it collapses to "plain text".
function flattenColor(raw: string): string {
  return raw
    .replace(/\b(?:oklch|oklab|lch|lab)\([^)]*\)/g, resolveModernColor)
    .replace(/color-mix\([^)]*\)/g, '#f4f4f5')
    .replace(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/g, (_m, r, g, b, a) => {
      const A = Math.max(0, Math.min(1, parseFloat(a)));
      const mix = (c: string) => Math.round(parseInt(c, 10) * A + 255 * (1 - A));
      const hex = (n: number) => n.toString(16).padStart(2, '0');
      return `#${hex(mix(r))}${hex(mix(g))}${hex(mix(b))}`;
    });
}

// Serialize a live DOM subtree into email-paste-safe HTML: drop [data-noemail]
// nodes (the greeting bar, notice composer, edit/delete, the copy button
// itself), rebuild every flex/grid container as a <table> (Outlook's Word
// renderer ignores flex/grid → without this everything just stacks), flatten
// alpha/color-mix colours to opaque hex, and wrap the whole block in a
// presentation <table> (Word doesn't block-render a bare <a>, so the old
// whole-body link left the frame/padding off there). Only "פתח במערכת →" is
// a link now.
function buildEmailHtml(sourceEl: HTMLElement, opts: { href: string; title: string; subtitle?: string }): string {
  const clone = sourceEl.cloneNode(true) as HTMLElement;
  // Must run BEFORE the [data-noemail] removal below — it relies on the
  // live/clone trees having identical structure (same querySelectorAll('*')
  // order) to line up computed styles with the right clone node.
  snapshotTailwindStyles(sourceEl, clone);
  clone.querySelectorAll('[data-noemail]').forEach(n => n.remove());
  layoutToTables(clone);
  clone.querySelectorAll<HTMLElement>('[style]').forEach(el => {
    let s = el.getAttribute('style') || '';
    s = flattenColor(s)
      .replace(/cursor:\s*pointer/g, 'cursor:default')
      // any font-family (they all lead with 'Rubk',system-ui,… → Times in Word)
      .replace(/font-family\s*:[^;]+/gi, `font-family:${EMAIL_FONT}`);
    // A nowrap+ellipsis label (e.g. KpiTile's moduleLabel) only actually
    // truncates in the live page because its flex parent carries min-width:0,
    // letting the flex item shrink below its own content size — flexbox-only
    // behavior with no table equivalent. In the table rebuild the same nowrap
    // instead makes the cell's min-content un-shrinkable, so at the 2-column
    // mobile width it overflows the card rather than ellipsizing (confirmed
    // live: table max-width doesn't help — table-layout:auto still grows past
    // it to fit an unbreakable nowrap run). Only in the email copy, let this
    // specific combination wrap onto a second line instead — plain overflow
    // (not ellipsis) is what a table can actually guarantee here, and a
    // wrapped label beats one bleeding past its card.
    if (/overflow:\s*hidden/.test(s) && /text-overflow:\s*ellipsis/.test(s)) {
      s = s.replace(/white-space:\s*nowrap;?/g, 'white-space:normal;');
    }
    el.setAttribute('style', s);
  });
  Array.from(clone.children).forEach(c => {
    const el = c as HTMLElement;
    el.setAttribute('style', (el.getAttribute('style') || '') + ';margin-bottom:16px');
  });
  const stamp = new Date().toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' });
  // Full width — fills the mail reading pane, no max-width/centering (user
  // 2026-09-06: capping it just left "המון שטח פנוי משני צידי התוכן" on a
  // wide desktop). The internal grids are width:100% too, and the
  // label↔value rows that used to spread in a wide card are now capped
  // locally (convertFlexToTable's isCompactPair) — so full-width no longer
  // means "flung apart".
  // Presentation table wrapper — not a bare <a>. Word renders <a> inline, so
  // padding/border/width on it were being dropped in Outlook. width as an
  // attribute AND in CSS (Word prefers the attribute).
  return `<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;font-family:${EMAIL_FONT};direction:rtl;background:${EMAIL_PAGE_BG}">`
    + `<tr><td style="padding:16px;font-family:${EMAIL_FONT};color:#1f2937">`
    + `<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;padding-bottom:12px;margin-bottom:16px;border-bottom:1px solid #e5e7eb;font-family:${EMAIL_FONT}"><tr>`
    + `<td style="vertical-align:baseline"><div style="font-size:16px;font-weight:700;color:#1f2937">${opts.title}</div>`
    + `<div style="font-size:12px;color:#6b7280;margin-top:2px">${opts.subtitle ? `${opts.subtitle} · ` : ''}${stamp}</div></td>`
    + `<td style="vertical-align:baseline;text-align:left;font-size:13px;font-weight:600;white-space:nowrap"><a href="${opts.href}" style="color:#2563eb;text-decoration:none">פתח במערכת →</a></td>`
    + `</tr></table>`
    + clone.innerHTML
    + `<div style="margin-top:20px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center">הופק על ידי DeployCenter</div>`
    + `</td></tr></table>`;
}

// Rich-HTML clipboard copy that also works where navigator.clipboard.write is
// blocked (some managed browsers, headless): select a hidden contenteditable
// node and answer the 'copy' event with both text/html and text/plain.
function copyRichHtml(html: string, plain: string): boolean {
  const box = document.createElement('div');
  box.setAttribute('contenteditable', 'true');
  box.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0';
  box.innerHTML = html;
  document.body.appendChild(box);
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(box);
  sel?.removeAllRanges();
  sel?.addRange(range);
  let ok = false;
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData('text/html', html);
    e.clipboardData?.setData('text/plain', plain);
    e.preventDefault();
  };
  try {
    document.addEventListener('copy', onCopy);
    ok = document.execCommand('copy');
  } finally {
    document.removeEventListener('copy', onCopy);
    sel?.removeAllRanges();
    document.body.removeChild(box);
  }
  return ok;
}

const CLOSED_DEFECT_STATUSES = ['Closed', 'Canceled', 'Rejected', 'Fixed'];

// Same DD/MM/YYYY (Oracle-style) discoveryDate format as release-intelligence.
// service.ts's own parseOracleDateAgeDays — a defect "opened today" is age===0.
function oracleDateAgeDays(ddMmYyyy: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(ddMmYyyy?.trim() ?? '');
  if (!m) return null;
  const [, d, mo, y] = m;
  const discovered = new Date(Number(y), Number(mo) - 1, Number(d)).getTime();
  if (Number.isNaN(discovered)) return null;
  return Math.floor((Date.now() - discovered) / 86400000);
}

// Cycle ending within this window still not meeting its QG target — see the
// CYCLE_ENDING_SOON block below.
const CYCLE_ENDING_SOON_HOURS = 48;

interface BlockedCr {
  crNumber: string; crLabel: string; cycleType: string; blockedCount: number;
  reasonDefects: { id: string; title: string }[];
}
interface OverdueUnstartedCr { crNumber: string; crLabel: string; plannedStart: string; }
type ForecastStatusValue = 'ON_TRACK' | 'AT_RISK' | 'BEHIND_PLAN';
interface ForecastPace {
  status: ForecastStatusValue; cycleType: string; isLastCycle: boolean;
  remainingScenarios: number; hoursRequired: number; hoursRemaining: number;
}
interface ForecastDefectRate {
  status: ForecastStatusValue; openDefects: number; expectedFixable: number;
  avgFixesPerDay: number; sampleVersions: number;
}
type HealthRecommendation = 'GO' | 'CONDITIONAL_GO' | 'NO_GO';
interface HealthBreakdown { coverageScore: number; qualityScore: number; riskScore: number; forecastScore: number; }
interface Overview {
  healthScore: number; healthBreakdown: HealthBreakdown; healthRecommendation: HealthRecommendation;
  readinessReasons?: string[]; softScore?: number;
  coveragePct: number; passedPct?: number; criticalDefects: number; openRisksCount: number;
  daysToGoLive: number | null; forecastStatus: ForecastStatusValue;
  forecastPace: ForecastPace | null; forecastDefectRate: ForecastDefectRate | null;
  qgSummary: Record<string, { count: number; threshold: number }>; qgPass: boolean;
  topRisks: { id: string; title: string; severity: string; status: string; mitigation: string | null }[];
  blockedCrs: BlockedCr[];
  overdueUnstartedCrs: OverdueUnstartedCr[];
  worstCr: { crNumber: string; count: number } | null;
  oldestCriticalDefectAgeDays: number | null;
  reviewMeetingTime: string | null;
  // coreTotal > 0 on the backend — whether any core-cycle test execution has
  // happened yet. Used to stop the readiness/coverage cards from reading
  // "PASS"/"partial coverage" when the version simply hasn't started
  // (bug found 2026-09-17).
  testingStarted: boolean;
  versionStatus: string;
  productionSinceDate: string | null;
}
interface DefectRow { id: string; title: string; severity: string; status: string; discoveryDate: string; targetRelease?: string; }
interface CrAssignmentRow { id: string; crNumber: string; crLabel: string | null; qaArrivalDate: string | null; qaReceived: boolean; }
interface TeamPlanStatusRow { teamId: string; teamName: string; total: number; draft: number; submitted: number; returned: number; approved: number; allDone: boolean; }
interface CrQualityRow {
  crNumber: string; crLabel: string; defectCount: number;
  // actualEffortDays/score/meetsTarget are null when this CR has no actual
  // effort filled in yet — "can't compute", not "passing" (bug found
  // 2026-09-17: these CRs used to be silently dropped from the list
  // entirely, hiding real target-breaching CRs that just hadn't had their
  // effort filled in).
  actualEffortDays: number | null; score: number | null; meetsTarget: boolean | null;
}

// score = Σ(defectCount × severityWeight) / actualEffortDays; a CR "meets the
// target" when score <= CR_QUALITY_TARGET — same constant and formula as
// release-intelligence.service.ts's getCrQualityScores (spec confirmed
// 2026-09-01).

type Urgency = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
interface VersionNotice { id: string; text: string; urgency: Urgency; createdAt: string; creator?: { fullName: string } }

const FORECAST_LABEL: Record<string, { label: string; color: string }> = {
  ON_TRACK: { label: 'בקצב', color: C.success },
  AT_RISK: { label: 'בסיכון', color: '#e8af00' },
  BEHIND_PLAN: { label: 'בחריגה', color: C.danger },
};


// Terse pace chip for the Coverage KpiTile sub-line (spec section 2, 2026-09-07):
// just "✓ בקצב" / "⚠ …". The detailed pace text + blocked/overdue CR triage
// stay reachable via the card's click-to-expand footer.
function coverageShort(o: Overview): { text: string; tone: 'ok' | 'warn' } {
  if (o.blockedCrs.length > 0) return { text: `⛔ ${o.blockedCrs.length} CR-ים חסומים`, tone: 'warn' };
  if (o.overdueUnstartedCrs.length > 0) return { text: `⚠ ${o.overdueUnstartedCrs.length} CR-ים בפיגור התחלה`, tone: 'warn' };
  // Bug found 2026-09-17: with no core-cycle execution at all yet, 0%
  // coverage isn't "partial" — the version simply hasn't started.
  if (!o.testingStarted) return { text: '⏳ הגרסה טרם החלה', tone: 'warn' };
  if (!o.forecastPace) return o.coveragePct >= 80 ? { text: '✓ כיסוי תקין', tone: 'ok' } : { text: '⚠ כיסוי חלקי', tone: 'warn' };
  switch (o.forecastStatus) {
    case 'ON_TRACK': return { text: '✓ בקצב', tone: 'ok' };
    case 'AT_RISK': return { text: '⚠ בסיכון לעמידה ביעד', tone: 'warn' };
    default: return { text: '⚠ בפיגור מול הקצב', tone: 'warn' };
  }
}
const CYCLE_LABEL: Record<string, string> = {
  CYCLE_1: 'סבב 1', CYCLE_2: 'סבב 2', CYCLE_3: 'סבב 3',
  STAND_ALONE: 'Stand Alone', UAT: 'UAT', REHEARSAL: 'חזרה גנרלית', GO_LIVE: 'עליה לאוויר',
};

// Readiness = GATED model (release-intelligence.service.ts, spec 2026-09-09):
// weighted 4-axis soft score, then capped by every triggered hard blocker's
// ceiling. Bands: ≥75 GO, 50-74 CONDITIONAL_GO, <50 NO_GO. readinessReasons
// carries the "why".
const HEALTH_REC: Record<HealthRecommendation, { label: string; color: string }> = {
  GO: { label: 'GO — מוכן', color: C.success },
  CONDITIONAL_GO: { label: 'GO בתנאים', color: '#e8af00' },
  NO_GO: { label: 'NO-GO', color: C.danger },
};


// qgSummary's keys (computeQgSummary, release-intelligence.service.ts) →
// display label + severity color, for the Quality Gate card's open-defects-
// by-severity mini chart (spec confirmed 2026-08-31).
const QG_SEVERITY_META: Record<string, { label: string; color: string }> = {
  showStopper: { label: 'Show Stopper', color: C.danger },
  severe: { label: 'Severe', color: C.warning },
  medium: { label: 'Medium', color: '#e8af00' },
  low: { label: 'Low', color: C.textMuted },
};


// One compact line of open-defects-by-severity counts for the תקלות KpiTile —
// "Show Stopper 1 · Severe 3 · Medium 11 · Low 6", no thresholds (the
// count-vs-threshold view isn't shown anywhere else anymore; PASS/FAIL on the
// readiness card carries the gate verdict). Non-zero Show Stopper/Severe go
// red+bold (spec 2026-09-07).
// Compact drillable severity pills for the aging ("beyond the clock" / ⏱)
// card's two rows (fixes-batch E.2, spec from the user's own mockup: rounded
// pill per non-zero severity, one row for the full aging set and one for
// open-only). Same colored-badge visual already used for risk-notice
// severity tags in this file (rounded-full border+bg), applied to defect
// severity via QG_SEVERITY_META instead of the risk-severity palette.
function SeverityPillsRow({ bySeverity, onPillClick }: {
  bySeverity: Record<string, { count: number; threshold: number }>;
  onPillClick: (severityLabel: string) => void;
}) {
  const entries = Object.entries(bySeverity).filter(([k, v]) => QG_SEVERITY_META[k] && v.count > 0);
  if (entries.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
      {entries.map(([k, v]) => {
        const meta = QG_SEVERITY_META[k];
        return (
          <button
            key={k}
            type="button"
            onClick={(e) => { e.stopPropagation(); onPillClick(meta.label); }}
            className="inline-flex cursor-pointer items-center rounded-full border bg-card px-2 py-px text-xs font-bold transition-opacity hover:opacity-80"
            style={{ color: meta.color, borderColor: `${meta.color}66` }}
          >
            {v.count} {meta.label}
          </button>
        );
      })}
    </div>
  );
}

function SeverityCountLine({ qgSummary }: { qgSummary: Record<string, { count: number; threshold: number }> }) {
  // Only the non-zero severities — keeps it to one short line in a ~180px card
  // (spec example: "3 Severe · 11 Medium · 6 Low").
  const entries = Object.entries(qgSummary).filter(([k, v]) => QG_SEVERITY_META[k] && v.count > 0);
  if (entries.length === 0) return <span style={{ ...TEXT.xs, color: C.textMuted }}>אין תקלות פתוחות</span>;
  return (
    <div style={{ ...TEXT.xs, color: C.textMuted, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 8px' }}>
      {entries.map(([k, v]) => {
        const strong = k === 'showStopper' || k === 'severe';
        return (
          <span key={k} style={{ whiteSpace: 'nowrap' as const }}>
            <span style={{ fontWeight: strong ? WEIGHT.bold : WEIGHT.semibold, color: strong ? C.danger : C.textPrimary }}>{v.count}</span>
            {' '}{QG_SEVERITY_META[k].label}
          </span>
        );
      })}
    </div>
  );
}







interface Props { token: string; versionId?: string; versionName?: string; role: string; fullName: string; onNavigate?: (view: string) => void; }

// Module home page for "ניהול בדיקות" — same structure as the general Home
// page: greeting → hero (here: the cycles panel with its countdown, reused
// unchanged) → rich per-area status cards → notice/alert strip. Every card
// and alert is backed by data the module already computes elsewhere — no new
// backend endpoints (spec confirmed 2026-08-31).
export const ReleaseIntelligenceHomeView: React.FC<Props> = ({ token, versionId, versionName, role, fullName, onNavigate }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const firstName = fullName.split(' ')[0] || fullName;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'שלום' : hour < 21 ? 'ערב טוב' : 'לילה טוב';

  const [overview, setOverview] = useState<Overview | null>(null);
  const [cycleData, setCycleData] = useState<CycleProgress | null>(null);
  const [defects, setDefects] = useState<DefectRow[]>([]);
  const [aging, setAging] = useState<{
    count: number; avgAgingDays: number; avgOverageDays: number; thresholdDays: number;
    bySeverity?: Record<string, { count: number; threshold: number }>;
    openOnlyBySeverity?: Record<string, { count: number; threshold: number }>;
  } | null>(null);
  const [crAssignments, setCrAssignments] = useState<CrAssignmentRow[]>([]);
  const [crQuality, setCrQuality] = useState<CrQualityRow[]>([]);
  const [teamPlanStatus, setTeamPlanStatus] = useState<TeamPlanStatusRow[]>([]);
  const [notices, setNotices] = useState<VersionNotice[]>([]);
  const [loading, setLoading] = useState(false);
  const [agingDrilldown, setAgingDrilldown] = useState<{ filter: 'aging' | 'agingOpenOnly'; value?: string; title: string } | null>(null);
  const [showStopperDrilldown, setShowStopperDrilldown] = useState(false);
  const [movedDrilldown, setMovedDrilldown] = useState(false);
  const [notReceivedExpanded, setNotReceivedExpanded] = useState(false);
  const [teamPlansExpanded, setTeamPlansExpanded] = useState(false);
  const [crQualityExpanded, setCrQualityExpanded] = useState(false);

  const [addingNotice, setAddingNotice] = useState(false);
  const [editingNoticeId, setEditingNoticeId] = useState<string | null>(null);
  const [noticeDraft, setNoticeDraft] = useState('');
  const [noticeUrgencyDraft, setNoticeUrgencyDraft] = useState<Urgency>('MEDIUM');
  const [savingNotice, setSavingNotice] = useState(false);
  const canEditNotice = isRm(role);

  // "העתק דף הבית למייל" — RM/ADMIN only. Serializes this whole view (minus the
  // data-noemail bits) to the clipboard as rich HTML wrapped in a deep link.
  const rootRef = useRef<HTMLDivElement>(null);
  const [appUrl, setAppUrl] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle');
  useEffect(() => {
    if (!isRm(role)) return;
    axios.get(`${API}/system-params`, { headers })
      .then(r => setAppUrl((r.data ?? []).find((p: any) => p.key === 'APP_PUBLIC_URL')?.value || ''))
      .catch(() => {});
  }, [role, headers]);

  const handleCopyToEmail = async () => {
    if (!rootRef.current || !versionId) return;
    try {
      const base = (appUrl || window.location.origin).replace(/\/+$/, '');
      const href = `${base}/?go=ri-home&versionId=${encodeURIComponent(versionId)}`;
      const reportTitle = versionName ? `סטטוס בדיקות גרסה ${versionName}` : 'סטטוס בדיקות גרסה';
      const html = buildEmailHtml(rootRef.current, {
        href,
        title: reportTitle,
        subtitle: '',
      });
      // Plain-text fallback for clients that don't render the HTML — a
      // standalone summary, not just 3 numbers. Mirrors the HTML's headline
      // KPIs + the "סיכונים ופעילויות" strip; each line is dropped when its
      // data isn't relevant (no alert, nothing overdue, no meeting set).
      const rmt = overview?.reviewMeetingTime ? new Date(overview.reviewMeetingTime) : null;
      const RISK_SEV_HE: Record<string, string> = { CRITICAL: 'קריטי', HIGH: 'גבוה', MEDIUM: 'בינוני', LOW: 'נמוך' };
      const alertLines = [
        ...(overview?.topRisks ?? []).map(r =>
          `• [סיכון ${RISK_SEV_HE[r.severity] ?? r.severity}${r.status === 'MITIGATED' ? ', בטיפול' : ''}] ${r.title}`),
        aging && aging.count > 0
          ? `• ${aging.count} תקלות חורגות מזמן הטיפול (ממוצע חריגה: ${aging.avgOverageDays} ימים)` : '',
        ...cyclesEndingSoonUnmet.map(c =>
          `• ${CYCLE_LABEL[c.cycleType] ?? c.cycleType} עומד להסתיים וטרם עומד ביעד (${c.successPct?.toFixed(2)}% מתוך ${c.qgTargetPct}%)`),
        overdueArrivalCrs.length > 0 ? `• ${overdueArrivalCrs.length} CR-ים חורגים ממועד הקבלה ל-QA` : '',
        (() => {
          const parts: string[] = [];
          if (rmt) {
            const a = new Date(); a.setHours(0, 0, 0, 0);
            const b = new Date(rmt); b.setHours(0, 0, 0, 0);
            const off = Math.round((b.getTime() - a.getTime()) / 86_400_000);
            if (Math.abs(off) <= 1) parts.push(off === 1 ? 'מחר תתקיים ישיבת סקירה' : off === 0 ? 'היום מתקיימת ישיבת סקירה' : 'אתמול התקיימה ישיבת סקירה');
          }
          if (teamsNotSubmitted.length > 0) parts.push(`${teamsNotSubmitted.length} צוותים טרם הגישו תוכנית CR`);
          return parts.length ? `• ${parts.join(' · ')}` : '';
        })(),
      ].filter(Boolean);
      const text = [
        reportTitle,
        new Date().toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' }),
        '',
        overview ? `מדד מוכנות הגרסה: ${overview.healthScore} (${HEALTH_REC[overview.healthRecommendation].label})` : '',
        overview ? `שער איכות: ${!overview.testingStarted ? 'הגרסה טרם החלה' : overview.qgPass ? 'PASS' : 'FAIL'}` : '',
        overview ? `כיסוי בדיקות: ${overview.coveragePct.toFixed(2)}%` : '',
        `תקלות פתוחות: ${openDefectsCount}${overview && overview.criticalDefects > 0 ? ` (מתוכן ${overview.criticalDefects} קריטיות)` : ''}`,
        overview && overview.daysToGoLive != null ? `ימים לעלייה לאוויר: ${overview.daysToGoLive}` : '',
        alertLines.length > 0 ? `\n— סיכונים ופעילויות —\n${alertLines.join('\n')}` : '',
        `\nפתח במערכת: ${href}`,
      ].filter(Boolean).join('\n');
      let ok = false;
      try {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })]);
        ok = true;
      } catch {
        ok = copyRichHtml(html, text); // fallback for browsers that block clipboard.write
      }
      setCopyState(ok ? 'done' : 'error');
    } catch (e) {
      console.error('Failed to copy Home to email', e);
      setCopyState('error');
    } finally {
      window.setTimeout(() => setCopyState('idle'), 3000);
    }
  };

  useEffect(() => {
    if (!versionId) { setOverview(null); setCycleData(null); setDefects([]); setAging(null); setCrAssignments([]); setCrQuality([]); setTeamPlanStatus([]); return; }
    setLoading(true);
    Promise.all([
      axios.get(`${API}/release-intelligence/overview/${versionId}`, { headers }).then(r => r.data).catch(() => null),
      axios.get(`${API}/release-intelligence/cycle-progress/${versionId}`, { headers }).then(r => r.data).catch(() => null),
      axios.get(`${API}/qc/defects?versionId=${versionId}`, { headers }).then(r => r.data ?? []).catch(() => []),
      axios.get(`${API}/release-intelligence/status-board/${versionId}`, { headers }).then(r => r.data).catch(() => null),
      axios.get(`${API}/version-cr-assignments/version/${versionId}`, { headers }).then(r => r.data ?? []).catch(() => []),
      axios.get(`${API}/release-intelligence/cr-quality/${versionId}`, { headers }).then(r => r.data ?? []).catch(() => []),
      // CR-plan submission status — the canonical per-team rollup (target-CR
      // reviews, exempt teams, unopened-screen seeding are all handled there),
      // reused rather than re-derived. RM/ADMIN see every team; a non-manager
      // gets only their own team back, which is fine — the strip just shows
      // "your team's" status then.
      axios.get(`${API}/cr-plans/version/${versionId}/team-status`, { headers }).then(r => r.data ?? []).catch(() => []),
    ]).then(([ov, cp, defs, sb, vca, crq, tps]) => {
      setOverview(ov);
      setCycleData(cp);
      setDefects(defs);
      setAging(sb?.aging ?? null);
      setCrAssignments(vca);
      setCrQuality(crq);
      setTeamPlanStatus(tps);
    }).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  const loadNotices = useCallback(() => {
    if (!versionId) { setNotices([]); return; }
    axios.get(`${API}/versions/${versionId}/notices`, { headers })
      .then(res => setNotices(res.data ?? []))
      .catch(() => setNotices([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);
  useEffect(() => { loadNotices(); setAddingNotice(false); setEditingNoticeId(null); }, [loadNotices]);

  const startAddNotice = () => { setNoticeDraft(''); setNoticeUrgencyDraft('MEDIUM'); setEditingNoticeId(null); setAddingNotice(true); };
  const startEditNotice = (n: VersionNotice) => { setNoticeDraft(n.text); setNoticeUrgencyDraft(n.urgency); setEditingNoticeId(n.id); setAddingNotice(false); };
  const cancelNoticeEdit = () => { setAddingNotice(false); setEditingNoticeId(null); };

  const saveNotice = async () => {
    if (!versionId || !noticeDraft.trim()) return;
    setSavingNotice(true);
    try {
      if (editingNoticeId) {
        await axios.patch(`${API}/versions/${versionId}/notices/${editingNoticeId}`, { text: noticeDraft, urgency: noticeUrgencyDraft }, { headers });
      } else {
        await axios.post(`${API}/versions/${versionId}/notices`, { text: noticeDraft, urgency: noticeUrgencyDraft }, { headers });
      }
      loadNotices();
      cancelNoticeEdit();
    } catch (e) { console.error('Failed to save RI home notice', e); }
    setSavingNotice(false);
  };

  const deleteNotice = async (id: string) => {
    if (!versionId) return;
    if (!window.confirm('למחוק את ההודעה? לא ניתן לשחזר לאחר המחיקה.')) return;
    setSavingNotice(true);
    try {
      await axios.delete(`${API}/versions/${versionId}/notices/${id}`, { headers });
      loadNotices();
      cancelNoticeEdit();
    } catch (e) { console.error('Failed to delete RI home notice', e); }
    setSavingNotice(false);
  };

  // ── Derived alerts — every one grounded in data already fetched above ──
  const showStoppersToday = useMemo(
    () => defects.filter(d => d.severity === 'Show Stopper' && oracleDateAgeDays(d.discoveryDate) === 0),
    [defects],
  );
  const cyclesEndingSoonUnmet = useMemo(() => {
    if (!cycleData) return [];
    const soonMs = CYCLE_ENDING_SOON_HOURS * 3600000;
    return cycleData.timeline.filter(c =>
      c.state === 'active'
      && new Date(c.plannedEnd).getTime() - Date.now() < soonMs
      && c.successPct != null && c.qgTargetPct != null && c.successPct < c.qgTargetPct
    );
  }, [cycleData]);
  // CRs already past their planned QA-arrival date and still not received —
  // each carries how many days it's overdue, so the strip can lead with the
  // lateness, not just "not here yet".
  const overdueArrivalCrs = useMemo(
    () => crAssignments
      .filter(a => !a.qaReceived && a.qaArrivalDate && new Date(a.qaArrivalDate).getTime() < Date.now())
      .map(a => ({ ...a, daysLate: Math.floor((Date.now() - new Date(a.qaArrivalDate!).getTime()) / 86400000) }))
      .sort((x, y) => y.daysLate - x.daysLate),
    [crAssignments],
  );
  const teamsNotSubmitted = useMemo(() => teamPlanStatus.filter(t => !t.allDone), [teamPlanStatus]);
  const failingCrs = useMemo(() => crQuality.filter(r => r.meetsTarget === false), [crQuality]);
  // Bug found 2026-09-17: CRs with no actualEffortDays filled in were being
  // silently excluded from crQuality entirely — real breaching CRs went
  // invisible with no sign anything was missing. Now they come back with
  // meetsTarget: null; surfaced as a distinct count so a real gap is visible
  // instead of silent.
  const unscoredCrs = useMemo(() => crQuality.filter(r => r.meetsTarget === null), [crQuality]);

  // Defects deferred to a later release (Target set) were analysed and pushed
  // out — they aren't a risk to this version, so they're kept out of the
  // headline count and surfaced separately (spec 2026-09-07 §1).
  //
  // Moved above the early returns below (2026-09-18 fix): these were
  // useMemo calls placed AFTER the `if (!versionId) return` / `if (loading)
  // return` checks, which is a real "Rendered fewer hooks than expected"
  // bug — on a render that takes an early return, React never reaches
  // these hooks at all, so the hook count differs from a render that does.
  // `defects` defaults to `[]` and CLOSED_DEFECT_STATUSES is a module
  // constant, so computing this before versionId/loading are known is safe.
  const openDefects = defects.filter(d => !CLOSED_DEFECT_STATUSES.includes(d.status));
  const movedToNextDefects = useMemo(() => openDefects.filter(d => !!(d.targetRelease || '').trim()), [openDefects]);
  // Severity breakdown of the "moved to future handling" subset specifically
  // — separate from qgSummary (which covers ALL open defects) — per the
  // user's explicit request (2026-09-17) to show it as its own line under
  // that specific count, same visual language as SeverityCountLine.
  const movedToNextBySeverity = useMemo(() => ({
    showStopper: { count: movedToNextDefects.filter(d => d.severity === 'Show Stopper').length, threshold: 0 },
    severe: { count: movedToNextDefects.filter(d => d.severity === 'Severe').length, threshold: 0 },
    medium: { count: movedToNextDefects.filter(d => d.severity === 'Medium').length, threshold: 0 },
    low: { count: movedToNextDefects.filter(d => d.severity === 'Low').length, threshold: 0 },
  }), [movedToNextDefects]);

  if (!versionId) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !overview) {
    return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;
  }

  const forecast = overview ? FORECAST_LABEL[overview.forecastStatus] : null;
  const movedToNextCount = movedToNextDefects.length;
  const openDefectsCount = openDefects.length - movedToNextCount;
  const reviewMeeting = overview?.reviewMeetingTime ? new Date(overview.reviewMeetingTime) : null;
  // Calendar-day offset of the review meeting (-1 = yesterday, 0 = today,
  // 1 = tomorrow). Scheduled notices only show in the [day before .. day
  // after] window; past-event text disappears after +1 day (spec 2026-09-07
  // §3a/§3c).
  const reviewDayOffset = reviewMeeting ? (() => {
    const a = new Date(); a.setHours(0, 0, 0, 0);
    const b = new Date(reviewMeeting); b.setHours(0, 0, 0, 0);
    return Math.round((b.getTime() - a.getTime()) / 86_400_000);
  })() : null;
  const reviewInWindow = reviewDayOffset != null && Math.abs(reviewDayOffset) <= 1;
  // §3b — one row unifies "review-meeting status" + "teams that still owe a CR plan".
  const showReviewSubmitRow = reviewInWindow || teamsNotSubmitted.length > 0;
  const alertCount = (aging && aging.count > 0 ? 1 : 0) + cyclesEndingSoonUnmet.length
    + (showStoppersToday.length > 0 ? 1 : 0) + (overdueArrivalCrs.length > 0 ? 1 : 0)
    + (showReviewSubmitRow ? 1 : 0)
    + (overview?.topRisks.length ?? 0);

  return (
    <div ref={rootRef} style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      {/* ── Greeting bar — excluded from the email copy (data-noemail); it also
          hosts the copy button, so the button never lands in the copy. ── */}
      <div data-noemail className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-5 py-3.5 shadow-xs">
        <div>
          <div className="text-lg font-bold text-foreground">{greeting}, {firstName} 👋</div>
          <div className="mt-0.5 text-xs text-subtle-foreground">
            {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
        {isRm(role) && (
          <button
            onClick={handleCopyToEmail}
            title="מעתיק את דף הבית ללוח כתוכן עשיר להדבקה במייל, עם קישור חוזר למערכת"
            className="flex-shrink-0 cursor-pointer rounded-md border-none px-4 py-2 font-sans text-xs font-semibold text-white"
            style={{ background: copyState === 'done' ? C.success : copyState === 'error' ? C.danger : C.brand }}
          >
            {copyState === 'done' ? '✓ הועתק — הדבק במייל' : copyState === 'error' ? '✕ ההעתקה נכשלה' : '📧 העתק דף הבית למייל'}
          </button>
        )}
      </div>

      {/* ── תמונת מצב — 5-card ribbon, above the cycles panel (spec 2026-09-07).
          Each card is a pure at-a-glance indicator; drill-downs live on the
          dedicated screens. ── */}
      {overview && (
        <div>
          <h2 style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: '0.06em', margin: '4px 0 -4px' }}>תמונת מצב</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))', gap: '12px', marginTop: '12px' }}>
            {/* מוכנות — הציון המגודר + QG + הסיבות שהוא נמצא איפה שהוא */}
            <KpiTile
              icon="🩺" accent={HEALTH_REC[overview.healthRecommendation].color} moduleLabel="מדד מוכנות"
              moduleLabelColor={C.moduleTracking}
              value={String(overview.healthScore)} label={HEALTH_REC[overview.healthRecommendation].label}
              sub={!overview.testingStarted ? '⏳ Quality Gate: הגרסה טרם החלה' : overview.qgPass ? '✓ Quality Gate: PASS' : '✗ Quality Gate: FAIL'}
              subTone={!overview.testingStarted ? 'warn' : overview.qgPass ? 'ok' : 'warn'}
              footer={
                (overview.readinessReasons && overview.readinessReasons.length > 0) ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {overview.readinessReasons.map((r, i) => (
                      <span key={i} style={{ ...TEXT.xs, color: r.startsWith('⛔') ? C.danger : C.textMuted, lineHeight: 1.35 }}>{r}</span>
                    ))}
                  </div>
                ) : undefined
              }
            />
            {/* כיסוי — % + progress bar, no parenthetical label */}
            <KpiTile
              icon="✅" accent={C.moduleTracking} moduleLabel="כיסוי בדיקות"
              value={`${overview.coveragePct.toFixed(2)}%`} label=""
              sub={coverageShort(overview).text}
              subTone={coverageShort(overview).tone}
              onClick={() => onNavigate?.('coverage-readiness')}
              footer={
                <div style={{ height: '6px', width: '100%', background: C.bgNested, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, overview.coveragePct))}%`, background: overview.coveragePct >= 80 ? C.success : C.warning, borderRadius: RADIUS.sm }} />
                </div>
              }
            />
            {/* תקלות — total + critical + one compact severity line */}
            <KpiTile
              icon="🐞" accent={C.moduleTracking} moduleLabel="תקלות"
              value={String(openDefectsCount)} label="תקלות פתוחות"
              sub={overview.criticalDefects > 0 ? `⚠ ${overview.criticalDefects} קריטיות` : '✓ אין תקלות קריטיות'}
              subTone={overview.criticalDefects > 0 ? 'warn' : 'ok'}
              footer={
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <SeverityCountLine qgSummary={overview.qgSummary} />
                  {movedToNextCount > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <span
                        onClick={e => { e.stopPropagation(); setMovedDrilldown(true); }}
                        style={{ ...TEXT.xs, color: C.brand, fontWeight: WEIGHT.semibold, cursor: 'pointer' }}
                      >
                        🔀 {movedToNextCount} תקלות שעוברות לטיפול עתידי ←
                      </span>
                      <SeverityCountLine qgSummary={movedToNextBySeverity} />
                    </div>
                  )}
                </div>
              }
              onClick={() => onNavigate?.('bug-dashboard')}
            />
            {/* תחזית — days + terse pace chip only (calc text removed).
                Bug found 2026-09-17: a COMPLETED version's daysToGoLive goes
                negative (plannedStart is in the past) and read as "N days
                overdue" — show when it actually went to production instead.
                Widened 2026-09-23 (fixes-batch F): MORNING_AFTER is ALSO
                "already live" (versions.service.ts's ACTIVE→MORNING_AFTER
                transition is the go-live/deployment-night step itself,
                COMPLETED is a later, separate close-out) — a version sitting
                in MORNING_AFTER was still falling into the raw-negative
                branch below and showing e.g. "-9 ... ✓ בקצב", which is what
                was actually reported. ACTIVE deliberately excluded — a
                version can still be mid-deployment-night in that status, not
                yet confirmed live. */}
            {(overview.versionStatus === 'COMPLETED' || overview.versionStatus === 'MORNING_AFTER') ? (
              <KpiTile
                icon="📈" accent={C.success} moduleLabel="תחזית"
                value="✓" label={overview.productionSinceDate ? `בייצור מתאריך ${formatDate(overview.productionSinceDate)}` : 'הגרסה בייצור'}
              />
            ) : (
              <KpiTile
                icon="📈" accent={C.moduleTracking} moduleLabel="תחזית"
                value={overview.daysToGoLive != null ? String(overview.daysToGoLive) : '—'} label="ימים לעלייה לאוויר"
                sub={forecast ? `${overview.forecastStatus === 'ON_TRACK' ? '✓' : '⚠'} ${forecast.label}` : null}
                subTone={overview.forecastStatus === 'ON_TRACK' ? 'ok' : 'warn'}
              />
            )}
            {/* סיכוני איכות — merged risks + CR-quality (both are release-risk mgmt) */}
            <KpiTile
              icon="⚠️"
              accent={failingCrs.length > 0 ? C.danger : C.moduleTracking}
              moduleLabel="סיכוני איכות" moduleLabelColor={C.moduleTracking}
              value={String(overview.openRisksCount)} label="סיכונים פתוחים"
              sideStat={{ icon: '🎯', value: `${failingCrs.length}/${crQuality.length}`, label: 'CR חורגים מיעד' }}
              sub={
                failingCrs.length > 0
                  ? `⚠ ${failingCrs.length} CR-ים חורגים מיעד האיכות`
                  : (overview.topRisks[0] ? `⚠ ${overview.topRisks[0].title}` : '✓ אין סיכונים פתוחים')
              }
              subTone={(overview.openRisksCount > 0 || failingCrs.length > 0) ? 'warn' : 'ok'}
              onClick={() => onNavigate?.('risks')}
              footer={unscoredCrs.length > 0 ? (
                <span style={{ ...TEXT.xs, color: C.textMuted }} title={unscoredCrs.map(r => r.crNumber).join(', ')}>
                  ⓘ {unscoredCrs.length} CR-ים לא ניתנים לחישוב (חסר Effort בפועל)
                </span>
              ) : undefined}
            />
          </div>
        </div>
      )}

      {/* ── Hero area — the cycles panel, reused as-is with its countdown clock ── */}
      {cycleData && <CyclesPanel data={cycleData} token={token} versionId={versionId} />}

      {/* ── רצועת הודעות והתראות — אותו רכיב בדיוק (RiskRow) ואותה עטיפה
          שדף הבית הכללי משתמש בהם לפיד הסיכונים/פעילויות שלו, לא חיקוי
          (spec confirmed 2026-08-31). ── */}
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📌 סיכונים ופעילויות — ניהול בדיקות</div>
          {alertCount > 0 && <div style={{ ...TEXT.xs, color: C.textMuted }}>{alertCount} פריטים</div>}
        </div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '12px' }}>התראות וסיכונים ממודול ניהול הבדיקות עבור הגרסה הנוכחית</div>

        {/* Manual, RM/ADMIN-authored notices — same endpoint/behavior as the
            general Home page's notices (spec confirmed 2026-08-31). */}
        {notices.filter(n => n.id !== editingNoticeId).map(n => (
          <div key={n.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: severityBg(n.urgency), border: `1px solid ${severityColor(n.urgency)}40`, borderRadius: RADIUS.md, padding: '10px 14px', marginBottom: '8px' }}>
            <span style={{ fontSize: '16px', flexShrink: 0 }}>📌</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* data-noemail: the emailed report keeps the urgency *colour*
                  (card tint + border, above) but drops the "נמוכה/בינונית/..."
                  pill — the wording adds noise there, the tint already says it
                  (spec 2026-09-05). Still shown on the live screen. */}
              <span data-noemail className="mb-1 inline-block rounded-full bg-card px-2 py-px text-xs font-bold" style={{ color: severityColor(n.urgency), border: `1px solid ${severityColor(n.urgency)}` }}>
                {severityLabel(n.urgency)}
              </span>
              <div style={{ ...TEXT.sm, color: C.textPrimary, whiteSpace: 'pre-wrap' as const }}>{n.text}</div>
            </div>
            {canEditNotice && (
              <div data-noemail className="flex flex-shrink-0 gap-2">
                <button onClick={() => startEditNotice(n)} className="cursor-pointer border-none bg-transparent font-sans text-xs font-semibold text-primary">✏️ ערוך</button>
                <button onClick={() => deleteNotice(n.id)} disabled={savingNotice} className="cursor-pointer border-none bg-transparent font-sans text-xs font-semibold text-danger">🗑 מחק</button>
              </div>
            )}
          </div>
        ))}

        <div data-noemail>
        {(addingNotice || editingNoticeId) ? (
          <div className="mb-3.5 rounded-md border border-border bg-muted px-3 py-2.5">
            <textarea
              autoFocus
              value={noticeDraft}
              onChange={e => setNoticeDraft(e.target.value)}
              placeholder="הודעה ידנית לצוותים (למשל: תזכורת לישיבת סטטוס)…"
              className="w-full min-h-[54px] resize-y rounded-sm border border-border bg-card px-2.5 py-1.5 font-sans text-sm text-foreground"
            />
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-subtle-foreground">רמת דחיפות:</span>
              <select
                value={noticeUrgencyDraft}
                onChange={e => setNoticeUrgencyDraft(e.target.value as Urgency)}
                className="rounded-sm border border-border bg-card px-2 py-1 font-sans text-xs text-foreground"
              >
                <option value="LOW">{severityLabel('LOW')}</option>
                <option value="MEDIUM">{severityLabel('MEDIUM')}</option>
                <option value="HIGH">{severityLabel('HIGH')}</option>
                <option value="CRITICAL">{severityLabel('CRITICAL')}</option>
              </select>
              <div className="flex-1" />
              <button onClick={cancelNoticeEdit} className="cursor-pointer rounded-sm border border-border bg-transparent px-3 py-1 font-sans text-xs text-subtle-foreground">ביטול</button>
              <button
                onClick={saveNotice}
                disabled={savingNotice || !noticeDraft.trim()}
                className={`rounded-sm border-none bg-primary px-3.5 py-1 font-sans text-xs font-semibold text-primary-foreground ${savingNotice || !noticeDraft.trim() ? 'cursor-not-allowed opacity-60' : 'cursor-pointer opacity-100'}`}
              >{savingNotice ? '...' : 'שמור'}</button>
            </div>
          </div>
        ) : canEditNotice ? (
          <button
            onClick={startAddNotice}
            className="mb-3.5 w-full cursor-pointer rounded-md border border-dashed border-border bg-transparent p-2 font-sans text-xs text-subtle-foreground transition-colors duration-fast ease-out hover:border-primary hover:text-primary"
          >
            📌 + הוסף הודעה ידנית לצוותים
          </button>
        ) : null}
        </div>

        {/* Non-closed ReleaseRisk rows — the actual risk register, worst
            severity first. Was only surfaced as the tile's top-1 title teaser
            before; now every open/mitigating one is listed (spec 2026-09-06). */}
        {(overview?.topRisks ?? []).map(r => {
          const sevLabel = { CRITICAL: 'קריטי', HIGH: 'גבוה', MEDIUM: 'בינוני', LOW: 'נמוך' }[r.severity] ?? r.severity;
          const sevIcon = r.severity === 'CRITICAL' || r.severity === 'HIGH' ? '🔴' : r.severity === 'MEDIUM' ? '🟠' : '🟡';
          return (
            <RiskRow
              key={r.id}
              icon={sevIcon}
              urgent={r.severity === 'CRITICAL' || r.severity === 'HIGH'}
              module="release-intelligence"
              title={r.title}
              desc={`חומרה: ${sevLabel} · ${r.status === 'MITIGATED' ? 'בטיפול' : 'פתוח'}${r.mitigation ? ' · ' + r.mitigation : ' · טרם הוגדרה מיטיגציה'}`}
              onClick={() => onNavigate?.('risks')}
            />
          );
        })}

        {/* Computed alerts — aging defects, cycles about to close without
            meeting target, Show Stopper defects opened today, CRs not yet
            received for testing — same RiskRow every alert on the general
            Home page uses (spec confirmed 2026-08-31). */}
        {aging && aging.count > 0 && (
          <RiskRow
            icon="⏱" urgent module="release-intelligence"
            title={`${aging.count} תקלות חורגות מזמן הטיפול`}
            desc={`מעל ${aging.thresholdDays} ימים • ממוצע חריגה: ${aging.avgOverageDays} ימים מעבר ליעד`}
            onClick={() => setAgingDrilldown({ filter: 'aging', title: 'תקלות חורגות מזמן הטיפול' })}
          >
            {/* E.2: two drillable severity-pill rows — total (all non-closed
                aging defects) and open-only (literal status "Open" among
                them), per the user's own mockup spec. */}
            {aging.bySeverity && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ ...TEXT.xs, color: C.textMuted, flexShrink: 0 }}>סה״כ:</span>
                  <SeverityPillsRow
                    bySeverity={aging.bySeverity}
                    onPillClick={(sev) => setAgingDrilldown({ filter: 'aging', value: sev, title: `תקלות חורגות מזמן הטיפול — ${sev}` })}
                  />
                </div>
                {aging.openOnlyBySeverity && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ ...TEXT.xs, color: C.textMuted, flexShrink: 0 }}>פתוחות בלבד:</span>
                    <SeverityPillsRow
                      bySeverity={aging.openOnlyBySeverity}
                      onPillClick={(sev) => setAgingDrilldown({ filter: 'agingOpenOnly', value: sev, title: `תקלות חורגות מזמן הטיפול (פתוחות בלבד) — ${sev}` })}
                    />
                  </div>
                )}
              </div>
            )}
          </RiskRow>
        )}

        {cyclesEndingSoonUnmet.map(c => (
          <RiskRow
            key={c.cycleType}
            icon="⏳" urgent module="release-intelligence"
            title={`${CYCLE_LABEL[c.cycleType] ?? c.cycleType} עומד להסתיים וטרם עומד ביעד`}
            desc={`${c.successPct?.toFixed(2)}% הצלחה מתוך יעד ${c.qgTargetPct}%`}
            onClick={() => onNavigate?.('cycle-progress')}
          />
        ))}

        {showStoppersToday.length > 0 && (
          <RiskRow
            icon="🔴" urgent module="release-intelligence"
            title={`${showStoppersToday.length} תקלות Show Stopper נפתחו היום`}
            desc="תקלות קריטיות חדשות שדורשות טיפול מיידי"
            onClick={() => setShowStopperDrilldown(true)}
          />
        )}

        {/* §3b — review meeting + CR-plan submissions in one row. The meeting
            part shows only within [yesterday .. tomorrow] (§3a/§3c), with
            relative phrasing; the submissions part persists until every team
            is done. */}
        {showReviewSubmitRow && (() => {
          const rd = reviewInWindow ? reviewDayOffset! : null;
          const timeStr = reviewMeeting ? reviewMeeting.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';
          const meetingTitle =
            rd === 1 ? `מחר (${timeStr}) תתקיים ישיבת סקירת הגרסה`
            : rd === 0 ? `היום (${timeStr}) מתקיימת ישיבת סקירת הגרסה`
            : rd === -1 ? 'אתמול התקיימה ישיבת סקירת הגרסה'
            : null;
          const nSub = teamsNotSubmitted.length;
          const title = meetingTitle ?? `${nSub} צוותים טרם השלימו הגשת תוכניות CR`;
          const descParts: string[] = [];
          if (meetingTitle) descParts.push('מעבר על תוכניות ה-CR והיערכות הגרסה');
          if (nSub > 0) descParts.push(`${nSub} צוותים טרם הגישו תוכנית CR${meetingTitle && rd !== -1 ? ' עד למועד הסקירה' : ''}`);
          return (
            <RiskRow
              icon="🗓" module="release-intelligence"
              urgent={rd === 0 || rd === 1 || nSub > 0}
              title={title}
              desc={descParts.join(' · ')}
              detail={nSub > 0 ? teamsNotSubmitted.map(t => {
                const pending = t.draft + t.returned;
                return `${t.teamName}${t.total > 0 ? ` — ${pending}/${t.total} ממתינות` : ' — טרם נפתחה תוכנית'}`;
              }) : undefined}
              expanded={teamPlansExpanded}
              onToggle={nSub > 0 ? () => setTeamPlansExpanded(v => !v) : undefined}
            />
          );
        })()}

        {overdueArrivalCrs.length > 0 && (
          <RiskRow
            icon="📦" urgent module="release-intelligence"
            title={`${overdueArrivalCrs.length} CR-ים חורגים ממועד הקבלה ל-QA`}
            desc="מועד המסירה המתוכנן מפיתוח חלף והפיתוח טרם נמסר לצוות הבדיקות"
            detail={overdueArrivalCrs.map(a => `${a.crNumber}${a.crLabel ? ' — ' + a.crLabel : ''} · באיחור ${a.daysLate} ${a.daysLate === 1 ? 'יום' : 'ימים'}`)}
            expanded={notReceivedExpanded}
            onToggle={() => setNotReceivedExpanded(v => !v)}
          />
        )}

        {/* Low development quality — large defect count relative to effort
            invested means the CR needs full regression, not just a spot
            check (user's own framing, spec confirmed 2026-09-01). Each CR in
            the expanded list is its own click target into its defect list
            (same crQualityDrilldown the KpiTile card used). */}
        {failingCrs.length > 0 && (
          <RiskRow
            icon="🎯" urgent module="release-intelligence"
            title={`${failingCrs.length} CR-ים לא עומדים ביעד איכות הפיתוח`}
            desc="כמות תקלות גבוהה יחסית להיקף הפיתוח — נדרשת רגרסיה מלאה ל-CR"
            detail={failingCrs.map(r => `${r.crNumber}${r.crLabel ? ' — ' + r.crLabel : ''} (ציון: ${(r.score as number).toFixed(2)})`)}
            expanded={crQualityExpanded}
            onToggle={() => setCrQualityExpanded(v => !v)}
          />
        )}
      </div>

      {agingDrilldown && (
        <DefectDrilldownModal
          token={token} versionId={versionId} screen="status-board"
          filter={agingDrilldown.filter} value={agingDrilldown.value}
          title={agingDrilldown.title} onClose={() => setAgingDrilldown(null)}
        />
      )}
      {showStopperDrilldown && (
        <DefectDrilldownModal
          token={token} versionId={versionId} screen="defects" filter="severity" value="Show Stopper"
          title="תקלות Show Stopper פתוחות" onClose={() => setShowStopperDrilldown(false)}
        />
      )}
      {movedDrilldown && (
        <DefectDrilldownModal
          token={token} versionId={versionId} screen="defects" filter="target-moved"
          title="תקלות שהועברו לטיפול בגרסה הבאה" onClose={() => setMovedDrilldown(false)}
        />
      )}
    </div>
  );
};

export default ReleaseIntelligenceHomeView;
