import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { createEvent, EventAttributes } from 'ics';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const EMAIL_PARAMS = [
  { key: 'EMAIL_ENABLED',           value: 'false', label: 'שליחת מייל מופעל',            type: 'boolean' },
  { key: 'EMAIL_HOST',              value: '',       label: 'שרת SMTP (HOST)',              type: 'text'    },
  { key: 'EMAIL_PORT',              value: '587',    label: 'פורט SMTP',                    type: 'text'    },
  { key: 'EMAIL_SECURE',            value: 'false',  label: 'TLS (true לפורט 465)',         type: 'boolean' },
  { key: 'EMAIL_USER',              value: '',       label: 'שם משתמש SMTP',               type: 'text'    },
  { key: 'EMAIL_PASSWORD',          value: '',       label: 'סיסמת SMTP',                  type: 'password'},
  { key: 'EMAIL_FROM',              value: '',       label: 'כתובת שולח (FROM)',            type: 'text'    },
  { key: 'EMAIL_DISTRIBUTION_LIST', value: '',       label: 'רשימת תפוצה (מופרדת בפסיקים)', type: 'text'    },
];

@Injectable()
export class EmailService implements OnModuleInit {
  async onModuleInit() {
    for (const p of EMAIL_PARAMS) {
      await prisma.systemParam.upsert({
        where:  { key: p.key },
        update: {},
        create: p,
      });
    }
  }

  async isEnabled(): Promise<boolean> {
    const p = await prisma.systemParam.findUnique({ where: { key: 'EMAIL_ENABLED' } });
    return p?.value === 'true';
  }

  async getConfig(): Promise<{ enabled: boolean; from: string; distributionList: string[] }> {
    const params = await prisma.systemParam.findMany({
      where: { key: { in: ['EMAIL_ENABLED', 'EMAIL_FROM', 'EMAIL_DISTRIBUTION_LIST'] } },
    });
    const get = (k: string) => params.find(p => p.key === k)?.value ?? '';
    const list = get('EMAIL_DISTRIBUTION_LIST')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    return { enabled: get('EMAIL_ENABLED') === 'true', from: get('EMAIL_FROM'), distributionList: list };
  }

  private async getSmtpConfig() {
    const params = await prisma.systemParam.findMany({
      where: { key: { in: EMAIL_PARAMS.map(p => p.key) } },
    });
    const get = (k: string) => params.find(p => p.key === k)?.value ?? '';

    if (get('EMAIL_ENABLED') !== 'true') throw new Error('שירות המייל אינו מופעל');

    const host = get('EMAIL_HOST');
    const from = get('EMAIL_FROM');
    if (!host || !from) throw new Error('תצורת SMTP חסרה (HOST / FROM)');

    return {
      host, from,
      port:   parseInt(get('EMAIL_PORT') || '587', 10),
      secure: get('EMAIL_SECURE') === 'true',
      user:   get('EMAIL_USER'),
      pass:   get('EMAIL_PASSWORD'),
      distributionList: get('EMAIL_DISTRIBUTION_LIST').split(',').map(s => s.trim()).filter(Boolean),
    };
  }

  async sendEmail(subject: string, text: string, extraRecipients?: string[]): Promise<void> {
    const cfg = await this.getSmtpConfig();
    const to = [...new Set([...cfg.distributionList, ...(extraRecipients ?? [])])];
    if (!to.length) throw new Error('רשימת תפוצה ריקה — הגדר EMAIL_DISTRIBUTION_LIST');

    const transport = nodemailer.createTransport({
      host: cfg.host, port: cfg.port, secure: cfg.secure,
      ...(cfg.user && cfg.pass ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
    });

    await transport.sendMail({ from: cfg.from, to: to.join(', '), subject, text });
  }

  // Sends a real calendar meeting invite (RFC5545 ICS via nodemailer's icalEvent) —
  // recognized by Outlook/Google Calendar as an "Accept/Decline" invitation, not a
  // plain attachment. `uid` should be stable per (runbook step) so re-sending
  // updates the same calendar entry instead of creating duplicates.
  async sendCalendarInvite(params: {
    uid:         string;
    subject:     string;
    description: string;
    start:       Date;
    end:         Date;
    attendees:   string[];
    location?:   string;
  }): Promise<void> {
    const cfg = await this.getSmtpConfig();
    const to = [...new Set(params.attendees)].filter(Boolean);
    if (!to.length) throw new Error('לא נבחרו משתתפים לזימון');

    const toDateArray = (d: Date): [number, number, number, number, number] =>
      [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];

    const { error, value: icsContent } = createEvent({
      uid: params.uid,
      title: params.subject,
      description: params.description,
      start: toDateArray(params.start),
      end: toDateArray(params.end),
      startInputType: 'local',
      location: params.location,
      organizer: { name: 'DeployCenter', email: cfg.from },
      attendees: to.map(email => ({ email, rsvp: true })),
      status: 'CONFIRMED',
    } as EventAttributes);

    if (error || !icsContent) throw new Error(`שגיאה ביצירת קובץ ICS: ${error?.message ?? 'unknown'}`);

    const transport = nodemailer.createTransport({
      host: cfg.host, port: cfg.port, secure: cfg.secure,
      ...(cfg.user && cfg.pass ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
    });

    await transport.sendMail({
      from: cfg.from,
      to: to.join(', '),
      subject: params.subject,
      text: params.description,
      icalEvent: {
        method: 'REQUEST',
        filename: 'invite.ics',
        content: icsContent,
      },
    });
  }
}
