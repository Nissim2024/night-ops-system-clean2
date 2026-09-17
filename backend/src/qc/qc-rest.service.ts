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

interface QcRestConfig { baseUrl: string; domain: string; project: string; bugStatusField: string; }

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
    const keys = ['QC_REST_BASE_URL', 'QC_REST_DOMAIN', 'QC_REST_PROJECT', 'QC_REST_BUG_STATUS_FIELD'];
    const rows = await prisma.systemParam.findMany({ where: { key: { in: keys } } });
    const byKey = new Map(rows.map(r => [r.key, r.value?.trim() ?? '']));
    const baseUrl = byKey.get('QC_REST_BASE_URL') ?? '';
    const domain = byKey.get('QC_REST_DOMAIN') ?? '';
    const project = byKey.get('QC_REST_PROJECT') ?? '';
    const bugStatusField = byKey.get('QC_REST_BUG_STATUS_FIELD') ?? '';
    if (!baseUrl || !domain || !project) {
      throw new BadRequestException('חיבור QC REST לא מוגדר במלואו בפרמטרי המערכת (Base URL / Domain / Project)');
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ''), domain, project, bugStatusField };
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
      throw new BadRequestException('למשתמש שלך אין משתמש QC מקושר (qcLogin). מנהל מערכת יכול לקשר זאת ב: ניהול → משתמשים → עריכת המשתמש → שדה "QC Login", או להריץ "סנכרון משתמשי QC".');
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

  private collectionUrl(config: QcRestConfig): string {
    return `${config.baseUrl}/rest/domains/${encodeURIComponent(config.domain)}/projects/${encodeURIComponent(config.project)}/defects`;
  }

  private releasesCollectionUrl(config: QcRestConfig): string {
    return `${config.baseUrl}/rest/domains/${encodeURIComponent(config.domain)}/projects/${encodeURIComponent(config.project)}/releases`;
  }

  // Mirrors releasesCollectionUrl's own shape — real releases read back from
  // listReleasesRest carry a flat `parent-id` pointing at their Release
  // Folder (not a nested URL path), so release-cycles are assumed to follow
  // the same flat-collection-plus-parent-id convention (`parent-id` on a
  // cycle = the Release ID, per probeEntityFields('release-cycle')'s own
  // label for that field: "Release ID") — UNVERIFIED until the create test
  // below actually runs, same as everything else in this file that hasn't
  // been tried against the real instance yet.
  private releaseCyclesCollectionUrl(config: QcRestConfig): string {
    return `${config.baseUrl}/rest/domains/${encodeURIComponent(config.domain)}/projects/${encodeURIComponent(config.project)}/release-cycles`;
  }

  private releaseFoldersCollectionUrl(config: QcRestConfig): string {
    return `${config.baseUrl}/rest/domains/${encodeURIComponent(config.domain)}/projects/${encodeURIComponent(config.project)}/release-folders`;
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
  // "status" shown here is BG_USER_04 (the org's real Bug Status — see
  // QC_REST_BUG_STATUS_FIELD) once configured; falls back to ALM's native
  // BG_STATUS only so the preview still shows *something* before that's set,
  // clearly labeled so it's never mistaken for the real field (bug found
  // 2026-09-16 — updateStatus() used to write to native BG_STATUS by mistake).
  async previewDefect(defectId: string, userId: string): Promise<{ id: string; title: string; status: string; statusFieldIsConfirmed: boolean; comments: string }> {
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
      const statusFieldIsConfirmed = !!config.bugStatusField;
      return {
        id: defectId,
        title: fields[REST_FIELD.title] ?? '',
        status: (statusFieldIsConfirmed ? fields[config.bugStatusField] : fields[REST_FIELD.status]) ?? '',
        statusFieldIsConfirmed,
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

  // Updates BG_USER_04 ("Bug Status") — the org's REAL business-workflow
  // status field, which every KPI/report actually runs on. NOT BG_STATUS
  // (ALM's native field) — this method wrote to BG_STATUS by mistake from
  // when it first shipped until the bug was found and confirmed 2026-09-16.
  // Refuses outright while QC_REST_BUG_STATUS_FIELD isn't configured, rather
  // than falling back to the known-wrong field. Unlike appendComment (which
  // only ever grows a low-risk free-text field), this writes a
  // workflow-sensitive field, so: the previous value is read first and
  // returned for an undo/confirmation, and a stamped line is appended to
  // dev-comments so the change is traceable in QC's own history too
  // (spec 2026-09-07: "לאפשר לעדכן את שדה הסטטוס ... ישירות ב-QC").
  async updateStatus(
    defectId: string,
    newStatus: string,
    authorLabel: string,
    userId: string,
  ): Promise<{ oldStatus: string; newStatus: string }> {
    if (!newStatus?.trim()) throw new BadRequestException('יש לבחור סטטוס');
    const config = await this.getConfig();
    if (!config.bugStatusField) {
      throw new BadRequestException(
        'שדה ה-Bug Status האמיתי (BG_USER_04) עדיין לא הוגדר ב-SystemParam ' +
        '(QC_REST_BUG_STATUS_FIELD). יש לגלות את שם ה-REST field שלו דרך "🔍 הצג ' +
        'את כל שמות השדות" ולמלא אותו ב-AdminPanel לפני עדכון סטטוס — כדי לא לכתוב ' +
        'שוב בטעות ל-BG_STATUS (השדה הלא-נכון).'
      );
    }
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const getRes = await axios.get(this.entityUrl(config, defectId), {
        headers: { Cookie: cookie, Accept: 'application/xml' },
        validateStatus: () => true,
      });
      if (getRes.status === 404) throw new BadRequestException(`תקלה ${defectId} לא נמצאה ב-QC`);
      if (getRes.status !== 200) throw new BadRequestException(`שגיאה בקריאת תקלה מ-QC (status ${getRes.status})`);
      const fields = parseFields(getRes.data);
      const oldStatus = fields[config.bugStatusField] ?? '';
      if (oldStatus === newStatus.trim()) return { oldStatus, newStatus: oldStatus };

      const currentComments = fields[COMMENT_FIELD] ?? '';
      const stamp = `[DeployCenter · ${authorLabel} · ${new Date().toLocaleString('he-IL')}]`;
      const auditLine = `${stamp}\nסטטוס עודכן: "${oldStatus}" ← "${newStatus.trim()}"`;
      const mergedComments = currentComments ? `${currentComments}\n---\n${auditLine}` : auditLine;

      const putRes = await axios.put(
        this.entityUrl(config, defectId),
        buildFieldsPayload({ [config.bugStatusField]: newStatus.trim(), [COMMENT_FIELD]: mergedComments }),
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml', Accept: 'application/xml' }, validateStatus: () => true },
      );
      if (putRes.status >= 300) {
        throw new BadRequestException(`עדכון סטטוס התקלה ב-QC נכשל (status ${putRes.status}): ${String(putRes.data).slice(0, 500)}`);
      }
      return { oldStatus, newStatus: newStatus.trim() };
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

  // ── Stage-0 de-risk for "create Release + Release Cycles via REST"
  // (2026-09-15) — both probes below are READ-ONLY (no PUT/POST), same risk
  // level as previewDefect/listAllFields: they answer "does this real QC
  // instance support it at all" before any schema/UI work is done, same
  // lesson as REST_FIELD (never assume ALM's documented REST shape matches
  // THIS project's actual customization without checking).

  // Asks QC's own customization API whether `entityType` (e.g. "release",
  // "release-cycle") is a real, addressable entity type in this project, and
  // what fields it requires — the actual question stage-0 needs answered
  // before writing any create-Release code. A 404/empty result here means
  // this QC instance doesn't expose that entity type over REST at all, which
  // would block the whole "write release back to QC" plan regardless of
  // permissions.
  async probeEntityFields(entityType: string, userId: string): Promise<EntityFieldMeta[]> {
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const url = `${config.baseUrl}/rest/domains/${encodeURIComponent(config.domain)}/projects/${encodeURIComponent(config.project)}/customization/entities/${encodeURIComponent(entityType)}/fields`;
      const res = await this.safeRequest(
        () => axios.get(url, { headers: { Cookie: cookie, Accept: 'application/xml' }, validateStatus: () => true }),
        config.baseUrl,
      );
      if (res.status === 404) throw new BadRequestException(`סוג הישות "${entityType}" לא נמצא ב-QC (status 404) — כנראה לא נתמך/לא מוגדר בפרויקט הזה`);
      if (res.status !== 200) throw new BadRequestException(`שגיאה בקריאת מטא-דאטה מ-QC עבור "${entityType}" (status ${res.status}): ${String(res.data).slice(0, 500)}`);
      return parseEntityFieldsXml(res.data);
    } finally {
      await this.logout(config, cookie);
    }
  }

  // Real-data read of the releases collection — confirms the read path works
  // end-to-end (auth, domain/project scoping, XML parsing) against actual
  // production release records, same risk level as previewDefect (reads
  // real data, writes nothing).
  async listReleasesRest(userId: string): Promise<Record<string, string>[]> {
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const url = `${config.baseUrl}/rest/domains/${encodeURIComponent(config.domain)}/projects/${encodeURIComponent(config.project)}/releases?page-size=20`;
      const res = await this.safeRequest(
        () => axios.get(url, { headers: { Cookie: cookie, Accept: 'application/xml' }, validateStatus: () => true }),
        config.baseUrl,
      );
      if (res.status === 404) throw new BadRequestException('אוסף ה-releases לא נמצא ב-QC REST (status 404) — ייתכן שאין תמיכה ב-endpoint הזה בגרסת QC הזו');
      if (res.status !== 200) throw new BadRequestException(`שגיאה בקריאת releases מ-QC (status ${res.status}): ${String(res.data).slice(0, 500)}`);
      return parseEntitiesListXml(res.data);
    } finally {
      await this.logout(config, cookie);
    }
  }

  // Real screenshots (2026-09-18) show new releases live under a year-named
  // folder (Releases → 2026 → ITv07-2026) — this is the `parent-id` every real
  // release we read back carried but couldn't explain until now. `release-
  // folders` is confirmed as a real REST entity name from production Jenkins
  // code (com.hot.qcupdater.enums.Entity), but never queried by us before —
  // this answers the still-open question from spec-qc-full-integration.md §9:
  // what's the real folder ID for "2026" (or whichever year), so release
  // creation can resolve the right `parent-id` instead of guessing. Optional
  // `query` uses the same `{field['value']}` syntax confirmed in that same
  // Jenkins code (e.g. `{name['2026']}` to find one folder by name).
  async listReleaseFoldersRest(userId: string, query?: string): Promise<Record<string, string>[]> {
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const qs = query ? `?query=${encodeURIComponent(query)}` : '?page-size=100';
      const res = await axios.get(`${this.releaseFoldersCollectionUrl(config)}${qs}`, {
        headers: { Cookie: cookie, Accept: 'application/xml' },
        validateStatus: () => true,
      });
      if (res.status === 404) throw new BadRequestException('אוסף ה-release-folders לא נמצא ב-QC REST (status 404)');
      if (res.status !== 200) throw new BadRequestException(`שגיאה בקריאת release-folders מ-QC (status ${res.status}): ${String(res.data).slice(0, 500)}`);
      return parseEntitiesListXml(res.data);
    } finally {
      await this.logout(config, cookie);
    }
  }

  // ── Defect "lab" — generic raw field read/write (2026-09-16) ────────────
  // ADMIN-only (gated in qc.controller.ts, not just action:qc_write) end-to-end
  // testing tool: create a real defect / edit arbitrary fields on a real one,
  // using whatever REST field names the admin already found via "🔍 הצג את כל
  // שמות השדות". Deliberately generic (no field allowlist, no fixed form) —
  // the real Create/Edit screens (per docs/spec-defects-module.md) come once
  // this lab has confirmed which fields/values QC's REST actually accepts;
  // building a polished form now, before that's known, would just mean
  // rebuilding it. Every write here still goes through the same per-user
  // qcLogin identity as the rest of this file — no shared account.

  // Generalizes updateStatus/appendComment's single-field PUT to an arbitrary
  // field map — confirms ALM REST's PUT-of-an-Entity is field-level merge
  // (only included fields are touched), not a full-resource replace, since
  // that's exactly what those two methods already rely on.
  async updateFieldsRaw(defectId: string, fields: Record<string, string>, userId: string): Promise<{ ok: true; putStatus: number }> {
    if (!fields || Object.keys(fields).length === 0) throw new BadRequestException('יש להזין לפחות שדה אחד');
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const putRes = await axios.put(
        this.entityUrl(config, defectId),
        buildFieldsPayload(fields),
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml', Accept: 'application/xml' }, validateStatus: () => true },
      );
      if (putRes.status >= 300) {
        throw new BadRequestException(`עדכון השדות נכשל ב-QC (status ${putRes.status}): ${String(putRes.data).slice(0, 800)}`);
      }
      return { ok: true, putStatus: putRes.status };
    } finally {
      await this.logout(config, cookie);
    }
  }

  // POST to the defects COLLECTION (not an entity URL) — creates a new real
  // defect in production QC. UNVERIFIED against this instance (same status as
  // attachments were before listAttachments was tried for real): the exact
  // required-fields set, and whether QC's response body carries the new ID
  // directly or only via a Location header, are exactly what this lab call is
  // for finding out. Tries both: parses the response body for an `id` field,
  // falls back to the Location header's trailing path segment.
  async createDefectRaw(fields: Record<string, string>, userId: string): Promise<{ id: string | null; raw: Record<string, string>; postStatus: number }> {
    if (!fields || Object.keys(fields).length === 0) throw new BadRequestException('יש להזין לפחות שדה אחד');
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const postRes = await axios.post(
        this.collectionUrl(config),
        buildFieldsPayload(fields),
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml', Accept: 'application/xml' }, validateStatus: () => true },
      );
      if (postRes.status >= 300) {
        throw new BadRequestException(`יצירת התקלה ב-QC נכשלה (status ${postRes.status}): ${String(postRes.data).slice(0, 800)}`);
      }
      const raw = typeof postRes.data === 'string' && postRes.data.trim().startsWith('<')
        ? parseFields(postRes.data)
        : {};
      const locationHeader = (postRes.headers?.['location'] as string) || '';
      const idFromLocation = locationHeader.split('/').filter(Boolean).pop() || null;
      return { id: raw[REST_FIELD.id] || idFromLocation, raw, postStatus: postRes.status };
    } finally {
      await this.logout(config, cookie);
    }
  }

  // Stage-0's actual remaining question (2026-09-16): permission is confirmed
  // (acting QC user has release-create rights) and the `release` entity is
  // confirmed readable — the only thing left unverified is whether this ALM
  // instance's classic REST API supports POST-creating one at all. One-shot
  // test create, same pattern as createDefectRaw (generic fields, no
  // allowlist — real releases in this project carry a `parent-id`, i.e. a
  // Release Folder, which real creation will very likely require even though
  // the field-metadata probe reported everything as non-required). Caller is
  // expected to use an obviously-named test value (e.g.
  // "DEPLOYCENTER_TEST_DELETE_ME") and delete it manually via QC UI after.
  async createReleaseRaw(fields: Record<string, string>, userId: string): Promise<{ id: string | null; raw: Record<string, string>; postStatus: number }> {
    if (!fields || Object.keys(fields).length === 0) throw new BadRequestException('יש להזין לפחות שדה אחד');
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const postRes = await axios.post(
        this.releasesCollectionUrl(config),
        buildFieldsPayload(fields, 'release'),
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml', Accept: 'application/xml' }, validateStatus: () => true },
      );
      if (postRes.status >= 300) {
        throw new BadRequestException(`יצירת ה-Release ב-QC נכשלה (status ${postRes.status}): ${String(postRes.data).slice(0, 800)}`);
      }
      const raw = typeof postRes.data === 'string' && postRes.data.trim().startsWith('<')
        ? parseFields(postRes.data)
        : {};
      const locationHeader = (postRes.headers?.['location'] as string) || '';
      const idFromLocation = locationHeader.split('/').filter(Boolean).pop() || null;
      return { id: raw[REST_FIELD.id] || idFromLocation, raw, postStatus: postRes.status };
    } finally {
      await this.logout(config, cookie);
    }
  }

  // ── Production orchestration (2026-09-18) — the real feature behind stage 2
  // of spec-qc-full-integration.md §3.5. Deliberately NOT wired into any
  // live user-facing trigger yet ("approve plan" → publish) — reachable only
  // through the lab's confirm-before-send button below, until it's actually
  // been run once against real QC. User's own call (2026-09-18): build the
  // whole chain now rather than one probe per deploy cycle, since testing
  // only happens where QC is reachable and each round-trip costs real days —
  // but every write still stays behind the same explicit-confirm lab gate as
  // everything else here, so an unverified guess can't reach real users
  // before a human has watched it work once.

  // Finds the year-named release-folder every real release we read back
  // lives under (confirmed via screenshot 2026-09-18: Releases → 2026 →
  // ITv07-2026); creates it if missing — same find-or-create principle as
  // the VBScript's createProjectList (checks rootNode.Children by name,
  // AddChild if not found). UNVERIFIED: whether POST against release-folders
  // behaves the same as POST against releases (assumed, not yet tried).
  async findOrCreateReleaseFolder(year: string, userId: string): Promise<{ id: string; created: boolean }> {
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const getRes = await axios.get(
        `${this.releaseFoldersCollectionUrl(config)}?query=${encodeURIComponent(`{name['${year}']}`)}`,
        { headers: { Cookie: cookie, Accept: 'application/xml' }, validateStatus: () => true },
      );
      if (getRes.status === 200) {
        const rows = parseEntitiesListXml(getRes.data);
        const existing = rows.find(r => r[REST_FIELD.title] === year);
        if (existing?.[REST_FIELD.id]) return { id: existing[REST_FIELD.id], created: false };
      }
      const postRes = await axios.post(
        this.releaseFoldersCollectionUrl(config),
        buildFieldsPayload({ [REST_FIELD.title]: year }, 'release-folder'),
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml', Accept: 'application/xml' }, validateStatus: () => true },
      );
      if (postRes.status >= 300) {
        throw new BadRequestException(`יצירת תיקיית שנה "${year}" ב-QC נכשלה (status ${postRes.status}): ${String(postRes.data).slice(0, 500)}`);
      }
      const raw = typeof postRes.data === 'string' && postRes.data.trim().startsWith('<') ? parseFields(postRes.data) : {};
      const idFromLocation = ((postRes.headers?.['location'] as string) || '').split('/').filter(Boolean).pop() || null;
      const id = raw[REST_FIELD.id] || idFromLocation;
      if (!id) throw new BadRequestException('תיקיית השנה נוצרה ב-QC אך לא זוהה ID בתשובה — בדוק ידנית ב-QC UI');
      return { id, created: true };
    } finally {
      await this.logout(config, cookie);
    }
  }

  // Named, confirmed-field wrapper over createReleaseRaw (§3.2: name,
  // start-date, end-date, user-01=Release Type ["IT", confirmed via
  // screenshot], user-03=Production Date, parent-id=year folder).
  async createReleaseProd(input: {
    name: string; startDate: string; endDate: string; productionDate?: string; description?: string; parentFolderId: string;
  }, userId: string): Promise<{ id: string | null; raw: Record<string, string> }> {
    const fields: Record<string, string> = {
      [REST_FIELD.title]: input.name,
      'start-date': input.startDate,
      'end-date': input.endDate,
      'parent-id': input.parentFolderId,
      'user-01': 'IT',
    };
    if (input.description) fields['description'] = input.description;
    if (input.productionDate) fields['user-03'] = input.productionDate;
    const { id, raw } = await this.createReleaseRaw(fields, userId);
    return { id, raw };
  }

  // Named, confirmed-field wrapper over createReleaseCycleRaw (§3.2:
  // parent-id=Release ID, user-01/02/03=QG Threshold High/Medium/Low, same
  // numbering already used against Oracle's RCYC_USER_01/02/03).
  async createReleaseCycleProd(input: {
    name: string; startDate: string; endDate: string; releaseId: string;
    environment?: string; thresholdHigh?: string; thresholdMedium?: string; thresholdLow?: string;
  }, userId: string): Promise<{ id: string | null; raw: Record<string, string> }> {
    const fields: Record<string, string> = {
      [REST_FIELD.title]: input.name,
      'start-date': input.startDate,
      'end-date': input.endDate,
      'parent-id': input.releaseId,
    };
    if (input.environment) fields['user-04'] = input.environment;
    if (input.thresholdHigh) fields['user-01'] = input.thresholdHigh;
    if (input.thresholdMedium) fields['user-02'] = input.thresholdMedium;
    if (input.thresholdLow) fields['user-03'] = input.thresholdLow;
    const { id, raw } = await this.createReleaseCycleRaw(fields, userId);
    return { id, raw };
  }

  // The whole chain in one call: resolve/create year folder → create release
  // under it → create every requested cycle under the release. Stops at the
  // first failure (a half-created Release with some cycles missing is a real
  // possibility if this throws partway through — surfaced via whichever
  // cycle's error message, not silently swallowed).
  async createReleaseWithCycles(input: {
    releaseName: string; startDate: string; endDate: string; productionDate?: string; year: string;
    cycles: { name: string; startDate: string; endDate: string; environment?: string; thresholdHigh?: string; thresholdMedium?: string; thresholdLow?: string }[];
  }, userId: string): Promise<{
    folder: { id: string; created: boolean };
    release: { id: string | null; raw: Record<string, string> };
    cycles: { name: string; id: string | null; raw: Record<string, string> }[];
  }> {
    const folder = await this.findOrCreateReleaseFolder(input.year, userId);
    const release = await this.createReleaseProd({
      name: input.releaseName, startDate: input.startDate, endDate: input.endDate,
      productionDate: input.productionDate, parentFolderId: folder.id,
    }, userId);
    if (!release.id) {
      throw new BadRequestException('ה-Release נוצר אך לא זוהה ID בתשובה מ-QC — לא ניתן להמשיך ליצירת הסבבים תחתיו. בדוק ידנית ב-QC UI.');
    }
    const cycles: { name: string; id: string | null; raw: Record<string, string> }[] = [];
    for (const c of input.cycles) {
      const created = await this.createReleaseCycleProd({ ...c, releaseId: release.id }, userId);
      cycles.push({ name: c.name, id: created.id, raw: created.raw });
    }
    return { folder, release, cycles };
  }

  // Same one-shot test as createReleaseRaw, for release-cycle — the other
  // half of stage-0's actual open question. Expected required field:
  // `parent-id` = the Release ID this cycle belongs to (per
  // probeEntityFields('release-cycle')'s own label for parent-id: "Release
  // ID") — caller should pass the ID of a real release (e.g. one just
  // created via createReleaseRaw) here.
  async createReleaseCycleRaw(fields: Record<string, string>, userId: string): Promise<{ id: string | null; raw: Record<string, string>; postStatus: number }> {
    if (!fields || Object.keys(fields).length === 0) throw new BadRequestException('יש להזין לפחות שדה אחד');
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const postRes = await axios.post(
        this.releaseCyclesCollectionUrl(config),
        buildFieldsPayload(fields, 'release-cycle'),
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml', Accept: 'application/xml' }, validateStatus: () => true },
      );
      if (postRes.status >= 300) {
        throw new BadRequestException(`יצירת ה-Release Cycle ב-QC נכשלה (status ${postRes.status}): ${String(postRes.data).slice(0, 800)}`);
      }
      const raw = typeof postRes.data === 'string' && postRes.data.trim().startsWith('<')
        ? parseFields(postRes.data)
        : {};
      const locationHeader = (postRes.headers?.['location'] as string) || '';
      const idFromLocation = locationHeader.split('/').filter(Boolean).pop() || null;
      return { id: raw[REST_FIELD.id] || idFromLocation, raw, postStatus: postRes.status };
    } finally {
      await this.logout(config, cookie);
    }
  }
}

export interface AttachmentMeta {
  name: string; fileSize: number; owner: string; uploadDate: string; description: string;
}

export interface EntityFieldMeta { name: string; label: string; type: string; required: boolean; raw: Record<string, string> | string; }

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

// Standard ALM/QC 11 customization-fields shape — PARTIALLY confirmed
// 2026-09-16 against the real instance: Name/Label DO come through as
// attributes exactly as assumed, but Type/required came back empty for every
// field on both `release` and `release-cycle` — meaning either this
// instance's schema doesn't expose them under the attribute names guessed
// here, or doesn't expose them at all for this entity type. Rather than
// guess a second time (same lesson as REST_FIELD's dev-comments saga),
// `raw` below dumps every attribute AND every child-element text this
// specific `<Field>` actually has, so the next real probe run shows the
// truth directly instead of forcing it through a fixed shape.
function parseEntityFieldsXml(xml: string): EntityFieldMeta[] {
  const parsed = xmlParser.parse(xml);
  const list = parsed?.Fields?.Field ?? [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((f: any) => {
    const raw: Record<string, string> = {};
    for (const [k, v] of Object.entries(f ?? {})) {
      if (v == null) continue;
      raw[k] = Array.isArray(v) ? v.map(String).join(' | ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    return {
      name: f?.['@_Name'] ?? f?.['@_name'] ?? '',
      label: f?.['@_Label'] ?? f?.['@_label'] ?? '',
      type: f?.['@_Type'] ?? f?.['@_type'] ?? f?.Type ?? '',
      required: ['Y', 'y', 'true', '1'].includes(String(f?.['@_required'] ?? f?.['@_Required'] ?? f?.Required ?? f?.Mandatory ?? '')),
      raw,
    };
  }).filter((f: EntityFieldMeta) => f.name);
}

// Standard ALM/QC 11 entity-collection shape:
// <Entities TotalResults="N"><Entity Type="release"><Fields><Field
// Name="..."><Value>...</Value></Field>...</Fields></Entity>...</Entities> —
// reuses the same per-entity field flattening as parseFields (single-entity
// GET), applied to each <Entity> in the collection.
function parseEntitiesListXml(xml: string): Record<string, string>[] {
  const parsed = xmlParser.parse(xml);
  const list = parsed?.Entities?.Entity ?? [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((entity: any) => {
    const fieldList = entity?.Fields?.Field ?? [];
    const fields = Array.isArray(fieldList) ? fieldList : [fieldList];
    const out: Record<string, string> = {};
    for (const f of fields) {
      const name = f?.['@_Name'];
      if (!name) continue;
      const value = Array.isArray(f.Value) ? f.Value[0] : f.Value;
      out[name] = value != null ? String(value) : '';
    }
    return out;
  });
}

function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildFieldsPayload(fields: Record<string, string>, entityType: string = 'defect'): string {
  const fieldsXml = Object.entries(fields)
    .map(([name, value]) => `<Field Name="${xmlEscape(name)}"><Value>${xmlEscape(value)}</Value></Field>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><Entity Type="${xmlEscape(entityType)}"><Fields>${fieldsXml}</Fields></Entity>`;
}
