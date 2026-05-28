import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as nodemailer from 'nodemailer';

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

  async sendEmail(subject: string, text: string, extraRecipients?: string[]): Promise<void> {
    const params = await prisma.systemParam.findMany({
      where: { key: { in: EMAIL_PARAMS.map(p => p.key) } },
    });
    const get = (k: string) => params.find(p => p.key === k)?.value ?? '';

    if (get('EMAIL_ENABLED') !== 'true') throw new Error('שירות המייל אינו מופעל');

    const host = get('EMAIL_HOST');
    const port = parseInt(get('EMAIL_PORT') || '587', 10);
    const secure = get('EMAIL_SECURE') === 'true';
    const user = get('EMAIL_USER');
    const pass = get('EMAIL_PASSWORD');
    const from = get('EMAIL_FROM');

    if (!host || !from) throw new Error('תצורת SMTP חסרה (HOST / FROM)');

    const distList = get('EMAIL_DISTRIBUTION_LIST')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const to = [...new Set([...distList, ...(extraRecipients ?? [])])];
    if (!to.length) throw new Error('רשימת תפוצה ריקה — הגדר EMAIL_DISTRIBUTION_LIST');

    const transport = nodemailer.createTransport({
      host, port, secure,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });

    await transport.sendMail({ from, to: to.join(', '), subject, text });
  }
}
