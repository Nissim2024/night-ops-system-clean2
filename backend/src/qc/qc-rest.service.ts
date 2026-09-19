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

  // Full DeployCenter display name for the acting user — used only in the
  // comment/status stamp text itself (2026-09-18 fix: was using the raw
  // login email before, which is neither the QC identity — that's already
  // separately recorded by QC itself, since every write authenticates as
  // the user's own qcLogin — nor a human-readable name).
  private async resolveFullName(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    return user?.fullName ?? 'DeployCenter';
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

  private releaseEntityUrl(config: QcRestConfig, releaseId: string): string {
    return `${config.baseUrl}/rest/domains/${encodeURIComponent(config.domain)}/projects/${encodeURIComponent(config.project)}/releases/${encodeURIComponent(releaseId)}`;
  }

  private releaseCycleEntityUrl(config: QcRestConfig, cycleId: string): string {
    return `${config.baseUrl}/rest/domains/${encodeURIComponent(config.domain)}/projects/${encodeURIComponent(config.project)}/release-cycles/${encodeURIComponent(cycleId)}`;
  }

  private releaseFoldersCollectionUrl(config: QcRestConfig): string {
    return `${config.baseUrl}/rest/domains/${encodeURIComponent(config.domain)}/projects/${encodeURIComponent(config.project)}/release-folders`;
  }

  // Generic collection URL for any entity-type segment — used by the newer
  // REQ (Requirements) primitives below instead of a one-off method per
  // entity, since that tree has more distinct entity types than
  // Release/Cycle did (requirement-folders, requirements, and later
  // test-folders/tests per spec-qc-full-integration.md §5).
  private collectionUrlFor(config: QcRestConfig, entityTypeSegment: string): string {
    return `${config.baseUrl}/rest/domains/${encodeURIComponent(config.domain)}/projects/${encodeURIComponent(config.project)}/${encodeURIComponent(entityTypeSegment)}`;
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
  async appendComment(defectId: string, note: string, userId: string): Promise<{ newValue: string }> {
    if (!note?.trim()) throw new BadRequestException('יש להזין טקסט להוספה');
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const fullName = await this.resolveFullName(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const getRes = await axios.get(this.entityUrl(config, defectId), {
        headers: { Cookie: cookie, Accept: 'application/xml' },
        validateStatus: () => true,
      });
      if (getRes.status === 404) throw new BadRequestException(`תקלה ${defectId} לא נמצאה ב-QC`);
      if (getRes.status !== 200) throw new BadRequestException(`שגיאה בקריאת תקלה מ-QC (status ${getRes.status})`);
      const currentValue = parseFields(getRes.data)[COMMENT_FIELD] ?? '';

      const stamp = buildStampLine(fullName);
      const newValue = currentValue ? `${currentValue}\n---\n${stamp}\n${note.trim()}` : `${stamp}\n${note.trim()}`;

      const putRes = await axios.put(
        this.entityUrl(config, defectId),
        buildFieldsPayload({ [COMMENT_FIELD]: newValue }),
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml' }, validateStatus: () => true },
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
    const fullName = await this.resolveFullName(userId);
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
      const stamp = buildStampLine(fullName);
      const auditLine = `${stamp}\nסטטוס עודכן: "${oldStatus}" ← "${newStatus.trim()}"`;
      const mergedComments = currentComments ? `${currentComments}\n---\n${auditLine}` : auditLine;

      const putRes = await axios.put(
        this.entityUrl(config, defectId),
        buildFieldsPayload({ [config.bugStatusField]: newStatus.trim(), [COMMENT_FIELD]: mergedComments }),
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml' }, validateStatus: () => true },
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

  // Picklist values (2026-09-19, spec-defects-module.md §6 follow-up) — the
  // user needs every field's real closed value-list (Severity/Priority/
  // Status/etc.) to build proper dropdowns instead of guessing, same problem
  // probeEntityFields solved for field NAMES. Standard ALM/QC 11 exposes this
  // as a separate "Project Lists" customization collection (distinct from
  // entity-fields, which at most references a list by id/name) — UNVERIFIED
  // against this real instance, so parseProjectListsXml dumps every
  // attribute/child raw (same defensive shape as parseEntityFieldsXml) rather
  // than assume the exact tag names in advance.
  async probeProjectLists(userId: string): Promise<ProjectListMeta[]> {
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const url = `${config.baseUrl}/rest/domains/${encodeURIComponent(config.domain)}/projects/${encodeURIComponent(config.project)}/customization/lists`;
      const res = await this.safeRequest(
        () => axios.get(url, { headers: { Cookie: cookie, Accept: 'application/xml' }, validateStatus: () => true }),
        config.baseUrl,
      );
      if (res.status === 404) throw new BadRequestException('אוסף ה-lists לא נמצא ב-QC REST (status 404) — ייתכן שאין תמיכה ב-endpoint הזה בגרסת QC הזו');
      if (res.status !== 200) throw new BadRequestException(`שגיאה בקריאת רשימות ערכים מ-QC (status ${res.status}): ${String(res.data).slice(0, 500)}`);
      return parseProjectListsXml(res.data);
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
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml' }, validateStatus: () => true },
      );
      if (putRes.status >= 300) {
        throw new BadRequestException(`עדכון השדות נכשל ב-QC (status ${putRes.status}): ${String(putRes.data).slice(0, 800)}`);
      }
      return { ok: true, putStatus: putRes.status };
    } finally {
      await this.logout(config, cookie);
    }
  }

  // ── Tier 2 field editing (2026-09-18, docs/spec-defects-module.md §6) —
  // production endpoint for the 6 "safe" (non-workflow-sensitive) fields
  // confirmed with the user: Assigned To, Priority, Severity, Estimated Fix
  // Time, Sub Module, Main Module. Takes BUSINESS keys, not raw REST field
  // names, and translates each through its own SystemParam (see
  // system-params.service.ts's QC_REST_FIELD_* entries) — same
  // "discover-then-configure, refuse while unset" pattern as
  // QC_REST_BUG_STATUS_FIELD, so this never guesses a field name into a real
  // QC write. The allowlist itself is enforced server-side (only these 6
  // business keys are ever accepted), independent of the SystemParam values,
  // so no caller can smuggle an arbitrary REST field name through this path.
  private static readonly TIER2_FIELD_PARAM_KEYS: Record<string, string> = {
    assignedTo: 'QC_REST_FIELD_ASSIGNED_TO',
    priority: 'QC_REST_FIELD_PRIORITY',
    severity: 'QC_REST_FIELD_SEVERITY',
    estimatedFixTime: 'QC_REST_FIELD_ESTIMATED_FIX_TIME',
    subModule: 'QC_REST_FIELD_SUB_MODULE',
    mainModule: 'QC_REST_FIELD_MAIN_MODULE',
  };

  async updateDefectTier2Fields(defectId: string, fields: Record<string, string>, userId: string): Promise<{ ok: true; putStatus: number }> {
    const unknownKeys = Object.keys(fields).filter(k => !(k in QcRestService.TIER2_FIELD_PARAM_KEYS));
    if (unknownKeys.length > 0) {
      throw new BadRequestException(`שדה/ות לא מוכרים (מותר רק: ${Object.keys(QcRestService.TIER2_FIELD_PARAM_KEYS).join(', ')}): ${unknownKeys.join(', ')}`);
    }
    const paramKeys = Object.values(QcRestService.TIER2_FIELD_PARAM_KEYS);
    const rows = await prisma.systemParam.findMany({ where: { key: { in: paramKeys } } });
    const restFieldByParamKey = new Map(rows.map(r => [r.key, (r.value ?? '').trim()]));

    const restFields: Record<string, string> = {};
    const unconfigured: string[] = [];
    for (const [businessKey, value] of Object.entries(fields)) {
      const paramKey = QcRestService.TIER2_FIELD_PARAM_KEYS[businessKey];
      const restName = restFieldByParamKey.get(paramKey);
      if (!restName) { unconfigured.push(businessKey); continue; }
      restFields[restName] = value;
    }
    if (unconfigured.length > 0) {
      throw new BadRequestException(
        `שם שדה ה-REST האמיתי עדיין לא הוגדר עבור: ${unconfigured.join(', ')}. יש לגלות אותו דרך "🔍 הצג את כל שמות השדות" ולמלא ב-AdminPanel לפני עדכון.`,
      );
    }
    return this.updateFieldsRaw(defectId, restFields, userId);
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
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml' }, validateStatus: () => true },
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
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml' }, validateStatus: () => true },
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
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml' }, validateStatus: () => true },
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
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml' }, validateStatus: () => true },
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

  // ── Gaps found against the user's requested capability list (2026-09-18,
  // spec-qc-full-integration.md §3.4 stage 1) — read existing cycles under a
  // release, and update an already-created release/cycle's dates+QG. Needed
  // for retry-after-reschedule: `createReleaseWithCycles` only ever creates,
  // so without these, a date change after the initial QC sync would either
  // silently do nothing or (worse) create a duplicate release/cycle.
  // UNVERIFIED against the real instance, same status as everything else in
  // this file not yet tried for real — same query-syntax assumption as
  // findOrCreateReleaseFolder's `{name['...']}` (confirmed real, per that
  // method's own comment), applied here to `parent-id` instead of `name`.
  async listReleaseCyclesRest(releaseId: string, userId: string): Promise<Record<string, string>[]> {
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const query = `{parent-id['${releaseId}']}`;
      const url = `${this.releaseCyclesCollectionUrl(config)}?query=${encodeURIComponent(query)}&page-size=100`;
      const res = await this.safeRequest(
        () => axios.get(url, { headers: { Cookie: cookie, Accept: 'application/xml' }, validateStatus: () => true }),
        config.baseUrl,
      );
      if (res.status === 404) return [];
      if (res.status !== 200) throw new BadRequestException(`שגיאה בקריאת סבבים מ-QC (status ${res.status}): ${String(res.data).slice(0, 500)}`);
      return parseEntitiesListXml(res.data);
    } finally {
      await this.logout(config, cookie);
    }
  }

  // Generic PUT on an existing release — mirrors updateFieldsRaw's
  // field-level-merge assumption (only included fields are touched), applied
  // to the `release` entity type instead of `defect`.
  async updateReleaseRaw(releaseId: string, fields: Record<string, string>, userId: string): Promise<{ ok: true; putStatus: number }> {
    if (!fields || Object.keys(fields).length === 0) throw new BadRequestException('יש להזין לפחות שדה אחד');
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const putRes = await axios.put(
        this.releaseEntityUrl(config, releaseId),
        buildFieldsPayload(fields, 'release'),
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml' }, validateStatus: () => true },
      );
      if (putRes.status >= 300) {
        throw new BadRequestException(`עדכון ה-Release ב-QC נכשל (status ${putRes.status}): ${String(putRes.data).slice(0, 500)}`);
      }
      return { ok: true, putStatus: putRes.status };
    } finally {
      await this.logout(config, cookie);
    }
  }

  // Generic PUT on an existing release-cycle (dates + QG thresholds after
  // creation) — same field-level-merge assumption.
  async updateReleaseCycleRaw(cycleId: string, fields: Record<string, string>, userId: string): Promise<{ ok: true; putStatus: number }> {
    if (!fields || Object.keys(fields).length === 0) throw new BadRequestException('יש להזין לפחות שדה אחד');
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const putRes = await axios.put(
        this.releaseCycleEntityUrl(config, cycleId),
        buildFieldsPayload(fields, 'release-cycle'),
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml' }, validateStatus: () => true },
      );
      if (putRes.status >= 300) {
        throw new BadRequestException(`עדכון ה-Release Cycle ב-QC נכשל (status ${putRes.status}): ${String(putRes.data).slice(0, 500)}`);
      }
      return { ok: true, putStatus: putRes.status };
    } finally {
      await this.logout(config, cookie);
    }
  }

  // Named, confirmed-field wrapper over updateReleaseRaw — same field set as
  // createReleaseProd's dates (§3.2), for pushing a reschedule.
  async updateReleaseDatesProd(
    releaseId: string,
    input: { startDate?: string; endDate?: string; productionDate?: string },
    userId: string,
  ): Promise<{ ok: true; putStatus: number }> {
    const fields: Record<string, string> = {};
    if (input.startDate) fields['start-date'] = input.startDate;
    if (input.endDate) fields['end-date'] = input.endDate;
    if (input.productionDate) fields['user-03'] = input.productionDate;
    return this.updateReleaseRaw(releaseId, fields, userId);
  }

  // Named, confirmed-field wrapper over updateReleaseCycleRaw — dates + QG
  // threshold update after the cycle already exists in QC.
  async updateReleaseCycleDatesProd(
    cycleId: string,
    input: { startDate?: string; endDate?: string; thresholdHigh?: string; thresholdMedium?: string; thresholdLow?: string },
    userId: string,
  ): Promise<{ ok: true; putStatus: number }> {
    const fields: Record<string, string> = {};
    if (input.startDate) fields['start-date'] = input.startDate;
    if (input.endDate) fields['end-date'] = input.endDate;
    if (input.thresholdHigh) fields['user-01'] = input.thresholdHigh;
    if (input.thresholdMedium) fields['user-02'] = input.thresholdMedium;
    if (input.thresholdLow) fields['user-03'] = input.thresholdLow;
    return this.updateReleaseCycleRaw(cycleId, fields, userId);
  }

  // ── Production publish (2026-09-18) — stage 2 of
  // docs/spec-qc-full-integration.md §3.5: turns an approved QA work plan's
  // cycles into a real QC Release + Release Cycles, and persists the real
  // IDs back onto QcRelease/Version/QaCycle so the rest of the app treats
  // this exactly like a manually-linked, Oracle-synced release (same
  // Version.qcReleaseId relation — no parallel field). Gated behind its own
  // SystemParam kill-switch, separate from the always-on admin lab, since
  // this is the first real (non-`rest-test`) write path and every
  // orchestration step below is still UNVERIFIED against production QC.
  private async requireReleasePublishEnabled(): Promise<void> {
    const flag = await prisma.systemParam.findUnique({ where: { key: 'QC_REST_RELEASE_PUBLISH_ENABLED' } });
    if ((flag?.value ?? '').trim().toLowerCase() !== 'true') {
      throw new BadRequestException('יצירת/עדכון גרסה ב-QC דרך REST כבויה (QC_REST_RELEASE_PUBLISH_ENABLED) — ניתן להדליק זאת במסך פרמטרי מערכת.');
    }
  }

  // Idempotency guard lives in the caller's data, not a flag: a version with
  // `qcReleaseId` already set has already been published — this method
  // refuses outright rather than risk creating a duplicate Release. Rescheduled
  // dates after publish go through syncVersionReleaseDates instead.
  async publishVersionRelease(versionId: string, userId: string): Promise<{
    relId: number; cycles: { cycleType: string; qcCycleId: number }[];
  }> {
    await this.requireReleasePublishEnabled();
    const version = await prisma.version.findUnique({
      where: { id: versionId },
      include: { qaWorkPlan: { include: { cycles: true } } },
    });
    if (!version) throw new BadRequestException('הגרסה לא נמצאה');
    if (version.qcReleaseId) throw new BadRequestException('הגרסה כבר מקושרת ל-QC — יש להשתמש בעדכון תאריכים, לא ביצירה חוזרת');
    const cycles = version.qaWorkPlan?.cycles ?? [];
    if (cycles.length === 0) throw new BadRequestException('אין תוכנית עבודת QA עם סבבים לגרסה זו');

    const startDate = cycles.reduce((min, c) => (c.plannedStart < min ? c.plannedStart : min), cycles[0].plannedStart);
    const latestCycleEnd = cycles.reduce((max, c) => (c.plannedEnd > max ? c.plannedEnd : max), cycles[0].plannedEnd);
    const endDate = version.plannedEnd ?? latestCycleEnd;
    const year = String(startDate.getFullYear());

    const result = await this.createReleaseWithCycles({
      releaseName: version.name,
      startDate: toQcDate(startDate),
      endDate: toQcDate(endDate),
      productionDate: version.plannedStart ? toQcDate(version.plannedStart) : undefined,
      year,
      cycles: cycles.map(c => ({
        name: qcCycleName(c.cycleType),
        startDate: toQcDate(c.plannedStart),
        endDate: toQcDate(c.plannedEnd),
      })),
    }, userId);

    if (!result.release.id) {
      throw new BadRequestException('ה-Release נוצר ב-QC אך לא זוהה ID בתשובה — לא ניתן לשמור את הקישור. בדוק ידנית ב-QC UI לפני ניסיון חוזר (כדי לא ליצור כפילות).');
    }
    const relId = Number(result.release.id);

    const qcRelease = await prisma.qcRelease.upsert({
      where: { relId },
      create: { relId, relName: version.name, relStartDate: startDate, relEndDate: endDate, active: true, lastSyncAt: new Date() },
      update: { relName: version.name, relStartDate: startDate, relEndDate: endDate, lastSyncAt: new Date() },
    });
    await prisma.version.update({ where: { id: versionId }, data: { qcReleaseId: qcRelease.id } });

    const persistedCycles: { cycleType: string; qcCycleId: number }[] = [];
    for (const created of result.cycles) {
      const local = cycles.find(c => qcCycleName(c.cycleType) === created.name);
      if (!local || !created.id) continue;
      const qcCycleId = Number(created.id);
      await prisma.qaCycle.update({ where: { id: local.id }, data: { qcCycleId } });
      persistedCycles.push({ cycleType: local.cycleType, qcCycleId });
    }
    return { relId, cycles: persistedCycles };
  }

  // The reschedule-after-publish path — pushes current DeployCenter dates
  // onto an already-created Release + its already-created Cycles. Cycles
  // that were never part of the original publish (qcCycleId still null —
  // e.g. a cycle type added later) are silently skipped, not created here:
  // creating a missing cycle after the fact is a different operation with
  // its own risk (order/duplicate-name concerns), out of scope for a plain
  // date sync.
  async syncVersionReleaseDates(versionId: string, userId: string): Promise<{ updated: string[] }> {
    await this.requireReleasePublishEnabled();
    const version = await prisma.version.findUnique({
      where: { id: versionId },
      include: { qcRelease: true, qaWorkPlan: { include: { cycles: true } } },
    });
    if (!version) throw new BadRequestException('הגרסה לא נמצאה');
    if (!version.qcRelease) throw new BadRequestException('הגרסה עדיין לא מקושרת ל-QC — יש ליצור אותה קודם');
    const cycles = version.qaWorkPlan?.cycles ?? [];
    const updated: string[] = [];

    const releaseStart = cycles.length ? cycles.reduce((min, c) => (c.plannedStart < min ? c.plannedStart : min), cycles[0].plannedStart) : undefined;
    const releaseEnd = version.plannedEnd ?? (cycles.length ? cycles.reduce((max, c) => (c.plannedEnd > max ? c.plannedEnd : max), cycles[0].plannedEnd) : undefined);
    await this.updateReleaseDatesProd(String(version.qcRelease.relId), {
      startDate: releaseStart ? toQcDate(releaseStart) : undefined,
      endDate: releaseEnd ? toQcDate(releaseEnd) : undefined,
      productionDate: version.plannedStart ? toQcDate(version.plannedStart) : undefined,
    }, userId);
    updated.push('release');

    for (const c of cycles) {
      if (!c.qcCycleId) continue;
      await this.updateReleaseCycleDatesProd(String(c.qcCycleId), {
        startDate: toQcDate(c.plannedStart),
        endDate: toQcDate(c.plannedEnd),
      }, userId);
      updated.push(c.cycleType);
    }

    await prisma.qcRelease.update({ where: { id: version.qcRelease.id }, data: { lastSyncAt: new Date() } });
    return { updated };
  }

  // ── Bulk status update (2026-09-18, docs/spec-defects-module.md §11 —
  // lowest priority, "nice to have", but doesn't need any new unverified QC
  // knowledge: it's just updateStatus looped over several defect ids. Never
  // stops the whole batch on one defect's failure (e.g. a defect whose
  // current status doesn't actually allow this transition in QC's real
  // workflow — updateStatus's own PUT would surface that per-defect).
  async bulkUpdateStatus(defectIds: string[], newStatus: string, userId: string): Promise<{
    updated: { defectId: string; oldStatus: string }[];
    failed: { defectId: string; error: string }[];
  }> {
    const updated: { defectId: string; oldStatus: string }[] = [];
    const failed: { defectId: string; error: string }[] = [];
    for (const defectId of defectIds) {
      try {
        const r = await this.updateStatus(defectId, newStatus, userId);
        updated.push({ defectId, oldStatus: r.oldStatus });
      } catch (e: any) {
        failed.push({ defectId, error: e?.message ?? 'שגיאה לא ידועה' });
      }
    }
    return { updated, failed };
  }

  // ── REQ / Requirements (2026-09-18, stage 2 of
  // docs/spec-qc-full-integration.md §4) — publishing a CR as a real QC
  // Requirement. Gated behind its own kill-switch, separate from release
  // publishing: this is a materially less-verified surface (whole 5-level
  // folder tree, ~20-field mapping, none of it tried against real QC yet).
  private async requireReqPublishEnabled(): Promise<void> {
    const flag = await prisma.systemParam.findUnique({ where: { key: 'QC_REST_REQ_PUBLISH_ENABLED' } });
    if ((flag?.value ?? '').trim().toLowerCase() !== 'true') {
      throw new BadRequestException('יצירת REQ ב-QC דרך REST כבויה (QC_REST_REQ_PUBLISH_ENABLED) — ניתן להדליק זאת במסך פרמטרי מערכת.');
    }
  }

  // Same find-or-create-by-name-under-parent principle as
  // findOrCreateReleaseFolder, generalized to any folder-like entity type
  // (spec §5.3: "אותו דפוס בדיוק חוזר בכל המודולים" — Requirements/Test-Plan
  // folders included). Filters the by-name query result by parent-id
  // client-side too, since it's not confirmed whether this QC instance's
  // query DSL supports combining two conditions in one `query` string.
  async findOrCreateFolder(
    collectionSegment: string, entityType: string, name: string, parentId: string | null, userId: string,
  ): Promise<{ id: string; created: boolean }> {
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const url = this.collectionUrlFor(config, collectionSegment);
      const getRes = await axios.get(
        `${url}?query=${encodeURIComponent(`{name['${name}']}`)}`,
        { headers: { Cookie: cookie, Accept: 'application/xml' }, validateStatus: () => true },
      );
      if (getRes.status === 200) {
        const rows = parseEntitiesListXml(getRes.data);
        const existing = rows.find(r => r[REST_FIELD.title] === name && (parentId == null || r['parent-id'] === parentId));
        if (existing?.[REST_FIELD.id]) return { id: existing[REST_FIELD.id], created: false };
      }
      const fields: Record<string, string> = { [REST_FIELD.title]: name };
      if (parentId != null) fields['parent-id'] = parentId;
      const postRes = await axios.post(
        url,
        buildFieldsPayload(fields, entityType),
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml' }, validateStatus: () => true },
      );
      if (postRes.status >= 300) {
        throw new BadRequestException(`יצירת תיקייה "${name}" (${entityType}) ב-QC נכשלה (status ${postRes.status}): ${String(postRes.data).slice(0, 500)}`);
      }
      const raw = typeof postRes.data === 'string' && postRes.data.trim().startsWith('<') ? parseFields(postRes.data) : {};
      const idFromLocation = ((postRes.headers?.['location'] as string) || '').split('/').filter(Boolean).pop() || null;
      const id = raw[REST_FIELD.id] || idFromLocation;
      if (!id) throw new BadRequestException(`תיקייה "${name}" נוצרה ב-QC אך לא זוהה ID בתשובה — בדוק ידנית ב-QC UI`);
      return { id, created: true };
    } finally {
      await this.logout(config, cookie);
    }
  }

  // Walks/creates every level of a folder path in order, each one's id
  // becoming the next level's parent-id. One login/logout round-trip per
  // level (same simplicity-over-efficiency pattern as every other method
  // here) — acceptable for a low-frequency admin/publish action.
  async walkFolderPath(collectionSegment: string, entityType: string, names: string[], userId: string): Promise<string> {
    let parentId: string | null = null;
    for (const name of names) {
      const folder = await this.findOrCreateFolder(collectionSegment, entityType, name, parentId, userId);
      parentId = folder.id;
    }
    if (!parentId) throw new BadRequestException('לא סופקו שמות תיקיות ליצירה');
    return parentId;
  }

  // `requirement` create — type-id=5 fixed (user-confirmed 2026-09-18
  // equivalent to OTA's RQ_TYPE_ID="Testing", i.e. a real CR leaf, not a
  // folder). `refFields` builds the special ValueReferenceValue XML shape
  // §4.2 documents for target-rel/target-rcyc (linking the REQ to the
  // Release/Cycle already created in stage 1) — NOT the same as a plain
  // <Value> field, so it's built separately from buildFieldsPayload.
  // Deliberately never sends an `owner` field — per the 2026-09-18 decision
  // (§4.4), the acting user's own qcLogin identity (already authenticating
  // this request) is what QC should attribute the creation to.
  async createRequirementRaw(
    fields: Record<string, string>,
    refFields: Record<string, { id: string; label: string }>,
    userId: string,
  ): Promise<{ id: string | null; raw: Record<string, string>; postStatus: number }> {
    const config = await this.getConfig();
    const qcLogin = await this.resolveQcLogin(userId);
    const cookie = await this.loginAsUser(config, qcLogin);
    try {
      const url = this.collectionUrlFor(config, 'requirements');
      const postRes = await axios.post(
        url,
        buildRequirementPayload(fields, refFields),
        { headers: { Cookie: cookie, 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml' }, validateStatus: () => true },
      );
      if (postRes.status >= 300) {
        throw new BadRequestException(`יצירת ה-Requirement ב-QC נכשלה (status ${postRes.status}): ${String(postRes.data).slice(0, 800)}`);
      }
      const raw = typeof postRes.data === 'string' && postRes.data.trim().startsWith('<') ? parseFields(postRes.data) : {};
      const idFromLocation = ((postRes.headers?.['location'] as string) || '').split('/').filter(Boolean).pop() || null;
      return { id: raw[REST_FIELD.id] || idFromLocation, raw, postStatus: postRes.status };
    } finally {
      await this.logout(config, cookie);
    }
  }

  // The real "publish this CR to QC" action — walks/creates the 5-level
  // folder path (§4.3: "[year] Releases" → org → version → cycle → CR
  // folder — the exact folder-name convention here is a best-effort read of
  // a screenshot description, NOT confirmed against real QC), then creates
  // the requirement leaf under it, linked to the already-created
  // Release/Cycle via target-rel/target-rcyc. Idempotent: refuses if this CR
  // already has a qcReqId. Requires the version to already be published to
  // QC (stage 1) AND the CR's assigned cycle to already have a real
  // qcCycleId — both are hard prerequisites, not just recommendations, per
  // the dependency chain in spec-qc-full-integration.md §8.
  async publishCrRequirement(assignmentId: string, userId: string): Promise<{ reqId: number }> {
    await this.requireReqPublishEnabled();
    const assignment = await prisma.qaAssignment.findUnique({
      where: { id: assignmentId },
      include: { version: { include: { qcRelease: true, qaWorkPlan: { include: { cycles: true } } } } },
    });
    if (!assignment) throw new BadRequestException('השיבוץ לא נמצא');
    if (assignment.qcReqId) throw new BadRequestException('כבר נוצר REQ ב-QC עבור CR זה');
    const version = assignment.version;
    if (!version.qcRelease) throw new BadRequestException('יש ליצור קודם את הגרסה ב-QC (Release+Cycles) לפני יצירת REQ עבור CR-ים שלה');

    const primaryCycleType = assignment.cycles[0];
    const qaCycle = version.qaWorkPlan?.cycles.find(c => c.cycleType === primaryCycleType);
    if (!primaryCycleType || !qaCycle?.qcCycleId) {
      throw new BadRequestException(`הסבב (${primaryCycleType ?? 'לא משובץ'}) של ה-CR הזה עדיין לא נוצר ב-QC`);
    }

    const year = String((version.qcRelease.relStartDate ?? new Date()).getFullYear());
    const cycleFolderName = qcCycleName(primaryCycleType);
    const folderId = await this.walkFolderPath(
      'requirement-folders', 'requirement-folder',
      [`${year} Releases`, 'HOT', version.name, cycleFolderName, assignment.crNumber],
      userId,
    );

    const title = `${assignment.crNumber} ${assignment.crLabel ?? ''}`.trim();
    const fields: Record<string, string> = {
      [REST_FIELD.title]: title,
      'parent-id': folderId,
      'type-id': '5',
      'user-02': assignment.crNumber,
    };
    if (assignment.qaEffort != null) fields['user-20'] = String(assignment.qaEffort);
    if (version.plannedStart) fields['user-12'] = toQcDate(version.plannedStart);
    if (assignment.notes) fields['req-comment'] = assignment.notes;

    const refFields: Record<string, { id: string; label: string }> = {
      'target-rel': { id: String(version.qcRelease.relId), label: version.name },
      'target-rcyc': { id: String(qaCycle.qcCycleId), label: cycleFolderName },
    };

    const created = await this.createRequirementRaw(fields, refFields, userId);
    if (!created.id) throw new BadRequestException('ה-Requirement נוצר ב-QC אך לא זוהה ID בתשובה — בדוק ידנית ב-QC UI לפני ניסיון חוזר (כדי לא ליצור כפילות)');
    const reqId = Number(created.id);
    await prisma.qaAssignment.update({ where: { id: assignmentId }, data: { qcReqId: reqId } });
    return { reqId };
  }

  // Batch/idempotent entry point for the "שיבוץ בודקים" screen's planned
  // "צור/סנכרן REQ" button — publishes every CR in the version not yet
  // published, one at a time, never stopping the whole batch on a single
  // CR's failure (a bad cycle/folder-name assumption for one CR shouldn't
  // block the rest). Re-running it after new assignments is safe — it only
  // ever touches assignments with qcReqId still null.
  async publishPendingReqsForVersion(versionId: string, userId: string): Promise<{
    created: { crNumber: string; reqId: number }[];
    failed: { crNumber: string; error: string }[];
  }> {
    const pending = await prisma.qaAssignment.findMany({ where: { versionId, qcReqId: null } });
    const created: { crNumber: string; reqId: number }[] = [];
    const failed: { crNumber: string; error: string }[] = [];
    for (const a of pending) {
      try {
        const r = await this.publishCrRequirement(a.id, userId);
        created.push({ crNumber: a.crNumber, reqId: r.reqId });
      } catch (e: any) {
        failed.push({ crNumber: a.crNumber, error: e?.message ?? 'שגיאה לא ידועה' });
      }
    }
    return { created, failed };
  }
}

// Local cycleType (QaCycle.cycleType) → the real QC cycle names this org
// uses (confirmed for REHEARSAL="Dress Rehearsal"/GO_LIVE="Go Live" — the
// exact literals already read via QC_RELEASES_SQL's `rcyc_name in (...)`
// filter in qc-releases.service.ts; the rest follow the same screenshot in
// spec-qc-full-integration.md §2 but are UNVERIFIED — only display names in
// QC UI, never used for our own linkage, which keys on the real qcCycleId).
const QC_CYCLE_NAME: Record<string, string> = {
  CYCLE_1: 'Cycle 1',
  CYCLE_2: 'Cycle 2',
  CYCLE_3: 'Cycle 3',
  UAT: 'UAT',
  REHEARSAL: 'Dress Rehearsal',
  GO_LIVE: 'Go Live',
  STAND_ALONE: 'Stand Alone Items',
};
function qcCycleName(cycleType: string): string {
  return QC_CYCLE_NAME[cycleType] ?? cycleType;
}

function toQcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface AttachmentMeta {
  name: string; fileSize: number; owner: string; uploadDate: string; description: string;
}

export interface EntityFieldMeta { name: string; label: string; type: string; required: boolean; raw: Record<string, string> | string; }
export interface ProjectListMeta { id: string; name: string; values: string[]; raw: Record<string, string> | string; }

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

// A <Value> is usually a plain string, but a reference-type field (e.g.
// target-rel/target-rcyc — see buildRequirementPayload) has a
// ValueReferenceValue attribute alongside its text, which fast-xml-parser
// turns into an object ({'@_ValueReferenceValue':.., '#text':..}) instead of
// a string. Found via the mock-qc-server smoke test (2026-09-18): every
// caller of this was doing String(value) unconditionally, producing the
// literal text "[object Object]" for any such field instead of its real
// text content — a real bug in our own parsing, not a QC-side issue.
function extractValueText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text'];
    return text != null ? String(text) : '';
  }
  return String(value);
}

function parseFields(xml: string): Record<string, string> {
  const parsed = xmlParser.parse(xml);
  const list = parsed?.Entity?.Fields?.Field ?? [];
  const arr = Array.isArray(list) ? list : [list];
  const out: Record<string, string> = {};
  for (const f of arr) {
    const name = f?.['@_Name'];
    if (!name) continue;
    const value = Array.isArray(f.Value) ? f.Value[0] : f.Value;
    out[name] = extractValueText(value);
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

// UNVERIFIED shape — same defensive approach as parseEntityFieldsXml: guess
// the most commonly documented ALM/QC 11 tag names first (Id/Name/Items/Item,
// falling back to List-Id/list-name/Value variants seen in other QC REST
// resources in this file), but always populate `raw` with every attribute
// and child this specific <List> element actually has, so a wrong guess
// about tag names still surfaces the real data instead of an empty result.
function parseProjectListsXml(xml: string): ProjectListMeta[] {
  const parsed = xmlParser.parse(xml);
  const list = parsed?.Lists?.List ?? parsed?.ProjectLists?.List ?? [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean).map((l: any) => {
    const raw: Record<string, string> = {};
    for (const [k, v] of Object.entries(l ?? {})) {
      if (v == null) continue;
      raw[k] = Array.isArray(v) ? v.map(String).join(' | ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    const items = l?.Items?.Item ?? l?.Values?.Value ?? l?.ListItems?.Item ?? [];
    const itemArr = Array.isArray(items) ? items : (items ? [items] : []);
    return {
      id: String(l?.Id ?? l?.['@_Id'] ?? l?.['@_id'] ?? ''),
      name: String(l?.Name ?? l?.['@_Name'] ?? l?.['@_name'] ?? ''),
      values: itemArr.map((v: any) => extractValueText(v)).filter(Boolean),
      raw,
    };
  }).filter((l: ProjectListMeta) => l.id || l.name);
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
      out[name] = extractValueText(value);
    }
    return out;
  });
}

// Matches QC's own native "add comment" stamp layout, per user description
// (2026-09-18): date+time anchored left (LTR), the acting user's name
// anchored right (RTL), on one line, bold, then a line break before the note
// body (which stays regular weight). Plain text has no real "alignment" —
// the Unicode bidi marks below (U+200E LRM, U+200F RLM) isolate each segment
// as strongly-directional so QC's own RTL-based rendering places them the
// same way its native stamp does, rather than leaving the mixed
// digits+Hebrew run to the bidi algorithm's default (which is what produced
// the "reversed/garbled-looking" stamp before this fix).
//
// Bold via literal `<b>...</b>` HTML, not a plain-text trick — `dev-comments`
// is presumed to be a QC "long text" rich-text field (its web UI edits it
// with a WYSIWYG toolbar in ALM/QC generally), so raw HTML in the field's
// string value is what its own rendering interprets as formatting. This
// nests safely inside buildFieldsPayload's XML: xmlEscape() there protects
// the OUTER XML transport (`<Value>&lt;b&gt;...&lt;/b&gt;</Value>` on the
// wire), and QC's XML parser decodes it back to a literal `<b>` in the
// stored field value before its own rich-text layer ever sees it.
// UNVERIFIED against real QC rendering (same status as the bidi marks above)
// — if this instance's `dev-comments` turns out to be plain-text only, the
// literal `<b>`/`</b>` characters would show up as visible text instead of
// rendering bold. Check the admin lab before trusting this.
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function buildStampLine(fullName: string): string {
  const now = new Date();
  const dateTime = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  return `<b>‎${dateTime}‎    ‏${fullName}‏</b>`;
}

function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Every caller of this must send its result with
// 'Content-Type': 'application/xml; charset=utf-8' — NOT bare
// 'application/xml'. Found via real production lab testing (2026-09-18):
// Hebrew text written through REST came back as characters that don't exist
// in any alphabet, on both write and read — QC's old Tomcat/JBoss server
// ignores this XML prolog's own `encoding="UTF-8"` and falls back to a
// single-byte charset for the HTTP body without an explicit charset in the
// Content-Type header, misreading every multi-byte UTF-8 Hebrew character.
// The corruption is stored in QC itself, not a display artifact — a missing
// charset here silently corrupts real production data on every write.
function buildFieldsPayload(fields: Record<string, string>, entityType: string = 'defect'): string {
  const fieldsXml = Object.entries(fields)
    .map(([name, value]) => `<Field Name="${xmlEscape(name)}"><Value>${xmlEscape(value)}</Value></Field>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><Entity Type="${xmlEscape(entityType)}"><Fields>${fieldsXml}</Fields></Entity>`;
}

// Same shape as buildFieldsPayload, plus the special ValueReferenceValue
// form spec-qc-full-integration.md §4.2 documents for reference-type fields
// (target-rel/target-rcyc — a Requirement's link to a Release/Cycle):
// <Field Name="target-rel"><Value ValueReferenceValue="378">ITv07-2026</Value></Field>
// UNVERIFIED against real QC — this format is read from Java source, never
// tried against this instance.
function buildRequirementPayload(fields: Record<string, string>, refFields: Record<string, { id: string; label: string }>): string {
  const plainXml = Object.entries(fields)
    .map(([name, value]) => `<Field Name="${xmlEscape(name)}"><Value>${xmlEscape(value)}</Value></Field>`)
    .join('');
  const refXml = Object.entries(refFields)
    .map(([name, { id, label }]) => `<Field Name="${xmlEscape(name)}"><Value ValueReferenceValue="${xmlEscape(id)}">${xmlEscape(label)}</Value></Field>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><Entity Type="requirement"><Fields>${plainXml}${refXml}</Fields></Entity>`;
}
