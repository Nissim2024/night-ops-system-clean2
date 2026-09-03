import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

// QC REST field names — NOT the same as the Oracle physical column names
// used everywhere else in this app (qc.service.ts's raw SQL). REST addresses
// fields by their "Name" (a REST-specific identifier from Project
// Customization), not their PhysicalName — confirmed against this QC
// instance's real field list (user-supplied 2026-09-01), e.g. physical
// column BG_DEV_COMMENTS is REST field "dev-comments", BG_SUMMARY is "name",
// BG_STATUS is "status". Getting this wrong doesn't 404 — QC either 406s
// (wrong Accept format, unrelated) or 500s with qccore.unknown-field-name,
// or for GET silently returns nothing under the wrong key.
const REST_FIELD = { id: 'id', title: 'name', status: 'status', comments: 'dev-comments' } as const;
// Kept as a single named constant (not user-configurable yet) since this
// tool intentionally only supports one, low-risk field for now (spec
// confirmed 2026-08-29: comment-append only, not a general defect editor —
// a bad write to a workflow-sensitive field like status could visibly break
// a real defect other teams depend on).
const COMMENT_FIELD = REST_FIELD.comments;

interface QcRestConfig { baseUrl: string; domain: string; project: string; }

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
    const keys = ['QC_REST_BASE_URL', 'QC_REST_DOMAIN', 'QC_REST_PROJECT'];
    const rows = await prisma.systemParam.findMany({ where: { key: { in: keys } } });
    const byKey = new Map(rows.map(r => [r.key, r.value?.trim() ?? '']));
    const baseUrl = byKey.get('QC_REST_BASE_URL') ?? '';
    const domain = byKey.get('QC_REST_DOMAIN') ?? '';
    const project = byKey.get('QC_REST_PROJECT') ?? '';
    if (!baseUrl || !domain || !project) {
      throw new BadRequestException('חיבור QC REST לא מוגדר במלואו בפרמטרי המערכת (Base URL / Domain / Project)');
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ''), domain, project };
  }

  // Every write-back action authenticates as the ACTING USER's own QC
  // identity — no shared service account, nothing stored (spec confirmed
  // 2026-09-02, verified against real production QC: QC accepts Basic auth
  // with an empty password for some accounts, e.g. "roiv", but not others,
  // e.g. "nissimp" who gets a real 401). By explicit user decision there is
  // NO fallback to a shared account for users whose QC account isn't set up
  // this way — the action is blocked with a message telling them who to ask,
  // never silently attributed to someone else.
  private async resolveQcLogin(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { qcLogin: true, fullName: true } });
    if (!user?.qcLogin) {
      throw new BadRequestException('למשתמש שלך אין משתמש QC מקושר (qcLogin) — פנה למנהל המערכת כדי לסנכרן זאת מול QC.');
    }
    return user.qcLogin;
  }

  // QC 11 REST session bootstrap: Basic-auth login (empty password — the
  // acting user's real QC password is never known to or stored by
  // DeployCenter) sets an SSO cookie, then a separate site-session call
  // upgrades it to a QCSession cookie that domain/project-scoped calls
  // require. Both cookies are forwarded together on every later request.
  // Logs out at the end of every call site (finally block in the public
  // methods below) so a session is never left open against production QC.
  private async loginAsUser(config: QcRestConfig, qcLogin: string): Promise<string> {
    const authRes = await this.safeRequest(
      () => axios.get(`${config.baseUrl}/authentication-point/authenticate`, {
        auth: { username: qcLogin, password: '' },
        validateStatus: () => true,
      }),
      config.baseUrl,
    );
    if (authRes.status !== 200) {
      throw new BadRequestException(`המשתמש שלך ב-QC (${qcLogin}) אינו מוגדר להתחברות ללא סיסמה (status ${authRes.status}). פנה למנהל QC כדי להפעיל זאת עבור המשתמש שלך.`);
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

  // Diagnostic — every field REST actually returns for this defect, real
  // REST field names (not DB column names). Exists because BG_DEV_COMMENTS
  // (the real Oracle column) turned out not to be the REST field name QC
  // recognizes for writes (406→XML fix got us past auth, then a real
  // qccore.unknown-field-name on PUT, then confirmed on GET too — defect
  // 47000's real comments came back empty via previewDefect, meaning the
  // GET side has the exact same wrong-key problem). Lets a human find the
  // right field name by inspecting a defect with known real data, instead
  // of guessing again (spec confirmed 2026-09-01).
  async listAllFields(defectId: string, userId: string): Promise<Record<string, string>> {
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const res = await axios.get(this.entityUrl(config, defectId), {
        headers: { Cookie: cookie, Accept: 'application/xml' },
        validateStatus: () => true,
      });
      if (res.status === 404) throw new BadRequestException(`תקלה ${defectId} לא נמצאה ב-QC`);
      if (res.status !== 200) throw new BadRequestException(`שגיאה בקריאת תקלה מ-QC (status ${res.status}): ${String(res.data).slice(0, 300)}`);
      return parseFields(res.data);
    } finally {
      await this.logout(config, cookie);
    }
  }

  // Read-only preview — title/status/current comment value, for the test
  // page to show "here's what's there today" before anyone appends anything.
  async previewDefect(defectId: string, userId: string): Promise<{ id: string; title: string; status: string; comments: string }> {
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
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
        title: fields[REST_FIELD.title] ?? '',
        status: fields[REST_FIELD.status] ?? '',
        comments: fields[COMMENT_FIELD] ?? '',
      };
    } finally {
      await this.logout(config, cookie);
    }
  }

  // Appends (never overwrites) — reads the current value first so a real
  // tester's existing comments are never destroyed by this tool.
  async appendComment(defectId: string, note: string, authorLabel: string, userId: string): Promise<{ newValue: string }> {
    if (!note?.trim()) throw new BadRequestException('יש להזין טקסט להוספה');
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
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

  // ── Attachments — spec confirmed 2026-09-03 ──────────────────────────────
  // UNVERIFIED against this real QC instance — built to ship now and correct
  // once real behavior is observed, per explicit instruction, rather than
  // block on a diagnostic first (unlike the field-name/406 issues above,
  // which WERE verified before shipping). The endpoint shape and XML tag
  // names below follow the standard HP ALM/QC 11 REST convention (attachment
  // content addressed by NAME under the parent entity's /attachments
  // collection, not by a numeric ID) — if this instance's real API differs,
  // the fix is localized to entityUrl()+attachments and parseAttachmentsXml
  // below, same pattern as REST_FIELD was for field names.
  async listAttachments(defectId: string, userId: string): Promise<AttachmentMeta[]> {
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const res = await axios.get(`${this.entityUrl(config, defectId)}/attachments`, {
        headers: { Cookie: cookie, Accept: 'application/xml' },
        validateStatus: () => true,
      });
      if (res.status === 404) return [];
      if (res.status !== 200) throw new BadRequestException(`שגיאה בקריאת קבצים מצורפים מ-QC (status ${res.status}): ${String(res.data).slice(0, 300)}`);
      return parseAttachmentsXml(res.data);
    } finally {
      await this.logout(config, cookie);
    }
  }

  // Streams the raw file content back — the caller (controller) relays it to
  // the browser. Attachment content is never persisted locally (spec: "לא
  // ישמור עותק מקומי של הקבצים").
  async downloadAttachment(defectId: string, fileName: string, userId: string): Promise<{ data: Buffer; contentType: string }> {
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const res = await axios.get(`${this.entityUrl(config, defectId)}/attachments/${encodeURIComponent(fileName)}`, {
        headers: { Cookie: cookie },
        responseType: 'arraybuffer',
        validateStatus: () => true,
      });
      if (res.status === 404) throw new BadRequestException(`הקובץ "${fileName}" לא נמצא ב-QC`);
      if (res.status !== 200) throw new BadRequestException(`שגיאה בהורדת הקובץ מ-QC (status ${res.status})`);
      const contentType = (res.headers?.['content-type'] as string) || 'application/octet-stream';
      return { data: Buffer.from(res.data), contentType };
    } finally {
      await this.logout(config, cookie);
    }
  }
}

export interface AttachmentMeta {
  name: string; fileSize: number; owner: string; uploadDate: string; description: string;
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

// Standard HP ALM/QC 11 attachments-list shape:
// <Attachments><Attachment><Name>.</Name><FileSize>.</FileSize>
// <Owner>.</Owner><CreationTime>.</CreationTime><Description>.</Description>
// </Attachment>...</Attachments> — UNVERIFIED against this real instance
// (see listAttachments' own comment). Reads several plausible tag-name
// variants per field defensively, since we don't yet know which this
// instance actually uses — same "don't trust a single guessed name" lesson
// as REST_FIELD, applied preemptively here instead of after a failure.
function firstDefined(obj: any, keys: string[]): string {
  for (const k of keys) {
    if (obj?.[k] != null) return String(Array.isArray(obj[k]) ? obj[k][0] : obj[k]);
  }
  return '';
}
function parseAttachmentsXml(xml: string): AttachmentMeta[] {
  const parsed = xmlParser.parse(xml);
  const list = parsed?.Attachments?.Attachment ?? parsed?.Entities?.Entity ?? [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((a: any) => ({
    name: firstDefined(a, ['Name', 'FileName', 'name']),
    fileSize: Number(firstDefined(a, ['FileSize', 'Size', 'size']) || 0),
    owner: firstDefined(a, ['Owner', 'CreatedBy', 'owner']),
    uploadDate: firstDefined(a, ['CreationTime', 'UploadDate', 'creation-time']),
    description: firstDefined(a, ['Description', 'description']),
  })).filter(a => a.name);
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
