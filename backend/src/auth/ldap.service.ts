import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LDAP_PARAM_DEFAULTS = [
  { key: 'LDAP_ENABLED',       value: 'false',                           label: 'LDAP / AD: מופעל (true/false)',      type: 'text'     },
  { key: 'LDAP_URL',           value: 'ldap://dc.company.local:389',     label: 'LDAP: כתובת שרת',                    type: 'text'     },
  { key: 'LDAP_BASE_DN',       value: 'DC=company,DC=local',             label: 'LDAP: Base DN',                      type: 'text'     },
  { key: 'LDAP_BIND_DN',       value: 'CN=svcldap,DC=company,DC=local',  label: 'LDAP: Bind DN (חשבון שירות)',        type: 'text'     },
  { key: 'LDAP_BIND_PASSWORD', value: '',                                 label: 'LDAP: סיסמת חשבון שירות',           type: 'password' },
  { key: 'LDAP_USER_FILTER',   value: '(sAMAccountName={{username}})',   label: 'LDAP: פילטר חיפוש משתמש',           type: 'text'     },
  { key: 'LDAP_EMAIL_ATTR',    value: 'mail',                            label: 'LDAP: שדה אימייל ב-AD',              type: 'text'     },
  { key: 'LDAP_NAME_ATTR',     value: 'displayName',                     label: 'LDAP: שדה שם מלא ב-AD',             type: 'text'     },
];

@Injectable()
export class LdapService implements OnModuleInit {
  private readonly logger = new Logger(LdapService.name);

  async onModuleInit() {
    for (const p of LDAP_PARAM_DEFAULTS) {
      const existing = await prisma.systemParam.findUnique({ where: { key: p.key } });
      if (!existing) {
        await prisma.systemParam.create({ data: p }).catch(err => {
          this.logger.warn(`Could not seed LDAP param ${p.key}: ${err.message}`);
        });
      }
    }
  }

  private async getConfig() {
    const keys = LDAP_PARAM_DEFAULTS.map(p => p.key);
    const params = await prisma.systemParam.findMany({ where: { key: { in: keys } } });
    const map = Object.fromEntries(params.map(p => [p.key, p.value]));
    return {
      enabled:      map['LDAP_ENABLED'] === 'true',
      url:          map['LDAP_URL'] || '',
      baseDn:       map['LDAP_BASE_DN'] || '',
      bindDn:       map['LDAP_BIND_DN'] || '',
      bindPassword: map['LDAP_BIND_PASSWORD'] || '',
      userFilter:   map['LDAP_USER_FILTER'] || '(sAMAccountName={{username}})',
      emailAttr:    map['LDAP_EMAIL_ATTR'] || 'mail',
      nameAttr:     map['LDAP_NAME_ATTR'] || 'displayName',
    };
  }

  async isEnabled(): Promise<boolean> {
    const param = await prisma.systemParam.findUnique({ where: { key: 'LDAP_ENABLED' } });
    return param?.value === 'true';
  }

  /**
   * Validate username + password against LDAP/AD.
   * Returns { email, fullName } on success, null on invalid credentials / user not found.
   * Returns null (does not throw) on connectivity errors.
   */
  async authenticate(username: string, password: string): Promise<{ email: string; fullName: string } | null> {
    const cfg = await this.getConfig();
    if (!cfg.enabled) return null;
    if (!cfg.url || !cfg.baseDn) {
      this.logger.warn('LDAP authentication attempted but LDAP_URL or LDAP_BASE_DN is not configured');
      return null;
    }

    const { Client } = await import('ldapts');

    // Step 1: bind with service account and search for the user
    const searchClient = new Client({ url: cfg.url, connectTimeout: 5000, timeout: 10000 });
    let userDn: string | undefined;
    let email = '';
    let fullName = '';

    try {
      await searchClient.bind(cfg.bindDn, cfg.bindPassword);

      const filter = cfg.userFilter.replace('{{username}}', this.escapeLdap(username));
      const { searchEntries } = await searchClient.search(cfg.baseDn, {
        filter,
        scope: 'sub',
        attributes: [cfg.emailAttr, cfg.nameAttr],
      });

      if (!searchEntries.length) {
        this.logger.debug(`LDAP: user "${username}" not found in directory`);
        return null;
      }

      const entry = searchEntries[0] as any;
      userDn   = entry.dn as string;
      email    = this.getAttr(entry, cfg.emailAttr).toLowerCase();
      fullName = this.getAttr(entry, cfg.nameAttr) || username;

      if (!email || !userDn) {
        this.logger.warn(`LDAP: user "${username}" found but missing email attribute or DN`);
        return null;
      }
    } catch (err: any) {
      this.logger.warn(`LDAP search error for "${username}": ${err.message}`);
      return null;
    } finally {
      await searchClient.unbind().catch(() => {});
    }

    // Step 2: validate password by attempting to bind as the found user
    const userClient = new Client({ url: cfg.url, connectTimeout: 5000, timeout: 10000 });
    try {
      await userClient.bind(userDn, password);
      await userClient.unbind();
      return { email, fullName };
    } catch {
      this.logger.debug(`LDAP: invalid password for "${username}"`);
      return null;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const cfg = await this.getConfig();
    if (!cfg.enabled) return { success: false, message: 'LDAP לא מופעל — הגדר LDAP_ENABLED=true תחילה' };
    if (!cfg.url || !cfg.baseDn) return { success: false, message: 'הגדרות LDAP חסרות (LDAP_URL או LDAP_BASE_DN)' };

    const { Client } = await import('ldapts');
    const client = new Client({ url: cfg.url, connectTimeout: 5000, timeout: 10000 });
    try {
      await client.bind(cfg.bindDn, cfg.bindPassword);
      return { success: true, message: 'החיבור ל-LDAP הצליח — חשבון השירות אומת בהצלחה' };
    } catch (err: any) {
      return { success: false, message: `שגיאת חיבור: ${err.message}` };
    } finally {
      await client.unbind().catch(() => {});
    }
  }

  private getAttr(entry: Record<string, unknown>, attr: string): string {
    const val = entry[attr];
    if (Array.isArray(val)) return String(val[0] ?? '');
    return String(val ?? '');
  }

  private escapeLdap(s: string): string {
    return s
      .replace(/\\/g, '\\5c')
      .replace(/\*/g, '\\2a')
      .replace(/\(/g, '\\28')
      .replace(/\)/g, '\\29')
      .replace(/\0/g, '\\00');
  }
}
