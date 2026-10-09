import * as dns from 'dns';
import * as net from 'net';
import * as os from 'os';
import axios from 'axios';
import { AI_PROVIDERS, AiConfig, AiProviderId, providerEndpoint } from './ai-provider';

// ── Firewall rules for the AI provider (2026-10-09) ─────────────────────────
// What IT has to open so the DeployCenter server can reach the AI service,
// derived from the configured endpoints (or the proxy, when one is set), plus
// a live check from the server itself: DNS → TCP → HTTPS. A failure at TCP
// is almost always a missing firewall rule.

export interface FwRule {
  provider: AiProviderId | 'proxy';
  label: string;
  direction: 'יוצא';
  source: string;
  destination: string;
  port: number;
  protocol: string;
  purpose: string;
  active: boolean;
}

export function serverIdentity(): { hostname: string; addresses: string[]; inDocker: boolean } {
  const addresses: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) addresses.push(a.address);
  }
  let inDocker = false;
  try { inDocker = require('fs').existsSync('/.dockerenv'); } catch { /* not linux */ }
  return { hostname: os.hostname(), addresses, inDocker };
}

function hostPort(url: string): { host: string; port: number; https: boolean } | null {
  try {
    const u = new URL(url);
    const https = u.protocol === 'https:';
    return { host: u.hostname, port: Number(u.port || (https ? 443 : 80)), https };
  } catch { return null; }
}

export function firewallRules(cfg: AiConfig): FwRule[] {
  const me = serverIdentity();
  const source = `שרת DeployCenter (${me.hostname}${me.addresses.length && !me.inDocker ? ` · ${me.addresses.join(', ')}` : ''})`;
  const configured = (Object.keys(AI_PROVIDERS) as AiProviderId[])
    .filter(id => id === cfg.activeProvider || cfg.providers[id]?.apiKey || cfg.providers[id]?.baseUrl);
  const rules: FwRule[] = [];
  const proxy = cfg.proxyUrl?.trim() ? hostPort(cfg.proxyUrl.trim()) : null;
  if (proxy) {
    rules.push({
      provider: 'proxy', label: 'Proxy', direction: 'יוצא', source, destination: proxy.host, port: proxy.port,
      protocol: proxy.https ? 'HTTPS' : 'HTTP (CONNECT)', purpose: 'יציאה לאינטרנט דרך ה-Proxy הארגוני', active: true,
    });
  }
  for (const id of configured) {
    const hp = hostPort(providerEndpoint(id, cfg.providers[id] ?? {}));
    if (!hp || hp.host.includes('<')) continue;
    rules.push({
      provider: id, label: AI_PROVIDERS[id].label, direction: 'יוצא',
      source: proxy ? `Proxy (${proxy.host})` : source,
      destination: hp.host, port: hp.port, protocol: hp.https ? 'HTTPS (TLS)' : 'HTTP',
      purpose: `קריאות AI ל-${AI_PROVIDERS[id].label}${proxy ? ' — לאשר את הכתובת ב-Proxy' : ''}`,
      active: id === cfg.activeProvider,
    });
  }
  return rules;
}

type Step = { ok: boolean; detail: string; ms: number };

async function timed<T>(fn: () => Promise<T>): Promise<{ v?: T; err?: any; ms: number }> {
  const t = Date.now();
  try { return { v: await fn(), ms: Date.now() - t }; } catch (err) { return { err, ms: Date.now() - t }; }
}

function tcpConnect(host: string, port: number, timeoutMs = 6000): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    const done = (e?: Error) => { s.destroy(); if (e) reject(e); else resolve(); };
    s.setTimeout(timeoutMs, () => done(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    s.once('connect', () => done());
    s.once('error', done);
  });
}

/** DNS → TCP → HTTPS from this server, for one rule */
export async function checkRule(rule: FwRule, cfg: AiConfig): Promise<{ destination: string; port: number; dns: Step; tcp: Step; https?: Step; verdict: string }> {
  const d = await timed(() => dns.promises.lookup(rule.destination, { all: true }));
  const dnsStep: Step = d.err
    ? { ok: false, detail: `לא נמצאה כתובת (${d.err.code ?? d.err.message}) — בעיית DNS או שם שגוי`, ms: d.ms }
    : { ok: true, detail: (d.v as dns.LookupAddress[]).map(a => a.address).join(', '), ms: d.ms };
  if (!dnsStep.ok && rule.provider !== 'proxy' && !cfg.proxyUrl) {
    return { destination: rule.destination, port: rule.port, dns: dnsStep, tcp: { ok: false, detail: 'לא נבדק (אין DNS)', ms: 0 }, verdict: 'DNS — השרת לא מכיר את הכתובת' };
  }
  // with a proxy, the AI host is reached through it: TCP is checked to the proxy only
  if (cfg.proxyUrl && rule.provider !== 'proxy') {
    const h = await timed(() => axios.get(`https://${rule.destination}:${rule.port}/`, {
      timeout: 10000, validateStatus: () => true,
      proxy: (() => { const u = new URL(cfg.proxyUrl!); return { protocol: u.protocol.replace(':', ''), host: u.hostname, port: Number(u.port || 80) }; })(),
    }));
    const httpsStep: Step = h.err
      ? { ok: false, detail: `${h.err.code ?? h.err.message}`, ms: h.ms }
      : { ok: true, detail: `HTTP ${(h.v as any).status} — השרת ענה דרך ה-Proxy`, ms: h.ms };
    return { destination: rule.destination, port: rule.port, dns: dnsStep, tcp: { ok: true, detail: 'דרך ה-Proxy', ms: 0 }, https: httpsStep,
      verdict: httpsStep.ok ? 'תקין — יש גישה דרך ה-Proxy' : 'ה-Proxy לא העביר את הבקשה — לבקש לאשר את הכתובת ב-Proxy' };
  }
  const t = await timed(() => tcpConnect(rule.destination, rule.port));
  const tcpStep: Step = t.err
    ? { ok: false, detail: t.err.code === 'ETIMEDOUT' ? 'אין תשובה (timeout) — כנראה חסום ב-Firewall' : t.err.code === 'ECONNREFUSED' ? 'החיבור נדחה (ECONNREFUSED)' : `${t.err.code ?? t.err.message}`, ms: t.ms }
    : { ok: true, detail: `פורט ${rule.port} פתוח`, ms: t.ms };
  if (!tcpStep.ok || rule.provider === 'proxy') {
    return { destination: rule.destination, port: rule.port, dns: dnsStep, tcp: tcpStep,
      verdict: tcpStep.ok ? 'תקין — ה-Proxy זמין' : 'חסום — יש לפתוח חוק Firewall לפי הטבלה' };
  }
  const h = await timed(() => axios.get(`https://${rule.destination}:${rule.port}/`, { timeout: 10000, validateStatus: () => true }));
  const httpsStep: Step = h.err
    ? { ok: false, detail: /certificate|SSL|TLS/i.test(String(h.err.message)) ? `בעיית תעודה/TLS (${h.err.code ?? h.err.message}) — ייתכן בדיקת SSL בארגון` : `${h.err.code ?? h.err.message}`, ms: h.ms }
    : { ok: true, detail: `HTTP ${(h.v as any).status} — השרת ענה`, ms: h.ms };
  return { destination: rule.destination, port: rule.port, dns: dnsStep, tcp: tcpStep, https: httpsStep,
    verdict: httpsStep.ok ? 'תקין — יש גישה מהשרת' : 'הפורט פתוח אך HTTPS נכשל — לבדוק בדיקת SSL/Proxy ארגוני' };
}

/** The text to paste into an IT firewall request */
export function firewallRequestText(rules: FwRule[]): string {
  const me = serverIdentity();
  const lines = [
    'בקשה לפתיחת חוקי Firewall — DeployCenter → שירות AI',
    '',
    `שרת מקור: ${me.hostname}${me.addresses.length ? ` (${me.addresses.join(', ')})` : ''}${me.inDocker ? ' — רץ ב-Docker: יש לציין את כתובת השרת המארח' : ''}`,
    '',
    ...rules.map((r, i) => `${i + 1}. ${r.direction} · מקור: ${r.source} · יעד: ${r.destination} · פורט: TCP ${r.port} · ${r.protocol} · מטרה: ${r.purpose}`),
    '',
    'הערות: היעדים הם שמות DNS (FQDN) — כתובות ה-IP של שירותי ענן משתנות, לכן מומלץ חוק לפי שם ולא לפי IP.',
    'התעבורה מוצפנת (TLS). DeployCenter יוזם את החיבור; אין צורך בחיבור נכנס.',
  ];
  return lines.join('\n');
}
