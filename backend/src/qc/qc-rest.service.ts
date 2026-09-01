import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

// The internal "Dev Comments" field on QC's BUG entity — same DB column
// (BG_DEV_COMMENTS) DEFECTS_SQL_SELECT already reads in qc.service.ts.
// Kept as a single named constant (not user-configurable yet) since this
// tool intentionally only supports one, low-risk field for now (spec
// confirmed 2026-08-29: comment-append only, not a general defect editor —
// a bad write to a workflow-sensitive field like status could visibly break
// a real defect other teams depend on).
const COMMENT_FIELD = 'BG_DEV_COMMENTS';

interface QcRestConfig { baseUrl: string; domain: string; project: string; username: string; password: string; }

// Standalone REST integration — deliberately NOT sharing anything with
// qc.service.ts's Oracle connection. That connection is a direct read-only
// SQL link to QC's own database; writing through it would bypass QC's
// workflow scripts, mandatory-field validation, and audit/history tables,
// and is against HP/Micro Focus's own guidance. This talks to QC's actual
// REST API instead — the only supported way to write back (spec confirmed
// 2026-08-29/30).
@Injectable()
export class QcRestService {
  private readonly logger = new Logger(QcRestService.name);

  private async getConfig(): Promise<QcRestConfig> {
    const keys = ['QC_REST_BASE_URL', 'QC_REST_DOMAIN', 'QC_REST_PROJECT', 'QC_REST_USERNAME', 'QC_REST_PASSWORD'];
    const rows = await prisma.systemParam.findMany({ where: { key: { in: keys } } });
    const byKey = new Map(rows.map(r => [r.key, r.value?.trim() ?? '']));
    const baseUrl = byKey.get('QC_REST_BASE_URL') ?? '';
    const domain = byKey.get('QC_REST_DOMAIN') ?? '';
    const project = byKey.get('QC_REST_PROJECT') ?? '';
    const username = byKey.get('QC_REST_USERNAME') ?? '';
    const password = byKey.get('QC_REST_PASSWORD') ?? '';
    if (!baseUrl || !domain || !project || !username || !password) {
      throw new BadRequestException('חיבור QC REST לא מוגדר במלואו בפרמטרי המערכת (Base URL / Domain / Project / משתמש / סיסמה)');
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ''), domain, project, username, password };
  }

  // QC 11 REST session bootstrap: Basic-auth login sets an SSO cookie, then a
  // separate site-session call upgrades it to a QCSession cookie that
  // domain/project-scoped calls require. Both cookies are forwarded together
  // on every later request. Logs out at the end of every call site (finally
  // block in the public methods below) so a test session is never left open
  // against production QC.
  private async login(config: QcRestConfig): Promise<string> {
    const authRes = await this.safeRequest(
      () => axios.get(`${config.baseUrl}/authentication-point/authenticate`, {
        auth: { username: config.username, password: config.password },
        validateStatus: () => true,
      }),
      config.baseUrl,
    );
    if (authRes.status !== 200) {
      throw new BadRequestException(`התחברות ל-QC נכשלה (status ${authRes.status}) — בדוק שם משתמש/סיסמה`);
    }
    const ssoCookies = extractCookies(authRes);

    const sessionRes = await this.safeRequest(
      () => axios.post(`${config.baseUrl}/rest/site-session`, null, {
        headers: { Cookie: ssoCookies },
        validateStatus: () => true,
      }),
      config.baseUrl,
    );
    if (sessionRes.status >= 300) {
      throw new BadRequestException(`יצירת session מול QC נכשלה (status ${sessionRes.status})`);
    }
    const sessionCookies = extractCookies(sessionRes);
    return mergeCookies(ssoCookies, sessionCookies);
  }

  // Network-level failures (DNS, connection refused, timeout) throw raw
  // Node/axios errors that otherwise surface as an opaque 500 — turned into
  // a clear, actionable message instead, since the person hitting this is
  // debugging a real connection, not reading a stack trace.
  private async safeRequest<T>(fn: () => Promise<T>, baseUrl: string): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      const code = err?.cause?.code || err?.code;
      if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
        throw new BadRequestException(`לא ניתן להתחבר לשרת QC ב-${baseUrl} (${code}) — בדוק את ה-URL ושה-backend רץ ברשת שיש לה גישה לשרת QC`);
      }
      throw err;
    }
  }

  private async logout(config: QcRestConfig, cookie: string) {
    await axios.get(`${config.baseUrl}/authentication-point/logout`, {
      headers: { Cookie: cookie },
      validateStatus: () => true,
    }).catch(err => this.logger.warn(`QC logout failed (non-fatal): ${err.message}`));
  }

  private entityUrl(config: QcRestConfig, defectId: string): string {
    return `${config.baseUrl}/rest/domains/${encodeURIComponent(config.domain)}/projects/${encodeURIComponent(config.project)}/defects/${encodeURIComponent(defectId)}`;
  }

  // Read-only preview — title/status/current comment value, for the test
  // page to show "here's what's there today" before anyone appends anything.
  async previewDefect(defectId: string): Promise<{ id: string; title: string; status: string; comments: string }> {
    const config = await this.getConfig();
    const cookie = await this.login(config);
    try {
      const res = await axios.get(this.entityUrl(config, defectId), {
        headers: { Cookie: cookie, Accept: 'application/xml' },
        validateStatus: () => true,
      });
      if (res.status === 404) throw new BadRequestException(`תקלה ${defectId} לא נמצאה ב-QC`);
      if (res.status !== 200) throw new BadRequestException(`שגיאה בקריאת תקלה מ-QC (status ${res.status}): ${String(res.data).slice(0, 300)}`);
      const fields = parseFields(res.data);
      return {
        id: defectId,
        title: fields['BG_SUMMARY'] ?? '',
        status: fields['BG_USER_04'] ?? fields['BG_STATUS'] ?? '',
        comments: fields[COMMENT_FIELD] ?? '',
      };
    } finally {
      await this.logout(config, cookie);
    }
  }

  // Appends (never overwrites) — reads the current value first so a real
  // tester's existing comments are never destroyed by this tool.
  async appendComment(defectId: string, note: string, authorLabel: string): Promise<{ newValue: string }> {
    if (!note?.trim()) throw new BadRequestException('יש להזין טקסט להוספה');
    const config = await this.getConfig();
    const cookie = await this.login(config);
    try {
      const getRes = await axios.get(this.entityUrl(config, defectId), {
        headers: { Cookie: cookie, Accept: 'application/xml' },
        validateStatus: () => true,
      });
      if (getRes.status === 404) throw new BadRequestException(`תקלה ${defectId} לא נמצאה ב-QC`);
      if (getRes.status !== 200) throw new BadRequestException(`שגיאה בקריאת תקלה מ-QC (status ${getRes.status})`);
      const currentValue = parseFields(getRes.data)[COMMENT_FIELD] ?? '';

      const stamp = `[DeployCenter · ${authorLabel} · ${new Date().toLocaleString('he-IL')}]`;
      const newValue = currentValue ? `${currentValue}\n---\n${stamp}\n${note.trim()}` : `${stamp}\n${note.trim()}`;

      const putRes = await axios.put(
        this.entityUrl(config, defectId),
        buildFieldsPayload({ [COMMENT_FIELD]: newValue }),
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml', Accept: 'application/xml' }, validateStatus: () => true },
      );
      if (putRes.status >= 300) {
        throw new BadRequestException(`עדכון התקלה ב-QC נכשל (status ${putRes.status}): ${String(putRes.data).slice(0, 500)}`);
      }
      return { newValue };
    } finally {
      await this.logout(config, cookie);
    }
  }
}

function extractCookies(res: any): string {
  const raw: string[] = res.headers?.['set-cookie'] ?? [];
  return raw.map(c => c.split(';')[0]).join('; ');
}

function mergeCookies(a: string, b: string): string {
  return [a, b].filter(Boolean).join('; ');
}

// QC 11's REST API only reliably produces XML for this resource — asking for
// JSON (the original implementation) hit a 406 "Not Acceptable" from QC's
// own Wink dispatcher on real production QC (found 2026-09-01). Native shape:
// <Entity Type="defect"><Fields><Field Name="BG_SUMMARY"><Value>...</Value>
// </Field>...</Fields></Entity> — flattens to a plain { NAME: value } map.
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function parseFields(xml: string): Record<string, string> {
  const parsed = xmlParser.parse(xml);
  const list = parsed?.Entity?.Fields?.Field ?? [];
  const arr = Array.isArray(list) ? list : [list];
  const out: Record<string, string> = {};
  for (const f of arr) {
    const name = f?.['@_Name'];
    if (!name) continue;
    const value = Array.isArray(f.Value) ? f.Value[0] : f.Value;
    out[name] = value != null ? String(value) : '';
  }
  return out;
}

function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildFieldsPayload(fields: Record<string, string>): string {
  const fieldsXml = Object.entries(fields)
    .map(([name, value]) => `<Field Name="${xmlEscape(name)}"><Value>${xmlEscape(value)}</Value></Field>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><Entity Type="defect"><Fields>${fieldsXml}</Fields></Entity>`;
}
