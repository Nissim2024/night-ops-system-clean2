import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const DEFAULT_PARAMS = [
  {
    key: 'EXCEL_FILE_PATH',
    value: '',
    label: 'נתיב קובץ הגשת פיתוחים',
    type: 'text',
  },
  {
    key: 'SUMMARY_OVERRUN_THRESHOLD_MINS',
    value: '30',
    label: 'סף חריגת זמן לדוח סיכום (דקות) — חריגה גדולה מזה מחייבת הסבר',
    type: 'number',
  },
  {
    key: 'WIZARD_AUTO_OPEN',
    value: 'true',
    label: 'פתח אשף הכנת תוכנית אוטומטית ביצירת גרסה מתבנית',
    type: 'boolean',
  },
  {
    key: 'USER_DEPS_CROSS_PHASE',
    value: 'false',
    label: 'אפשר יצירת תלויות per-user בין שלבים שונים (ברירת מחדל: בתוך שלב בלבד)',
    type: 'boolean',
  },
];

@Injectable()
export class SystemParamsService {
  async seed() {
    for (const p of DEFAULT_PARAMS) {
      await prisma.systemParam.upsert({
        where: { key: p.key },
        update: {},
        create: p,
      });
    }
  }

  async findAll() {
    return prisma.systemParam.findMany({ orderBy: { key: 'asc' } });
  }

  async getValue(key: string): Promise<string> {
    const p = await prisma.systemParam.findUnique({ where: { key } });
    return p?.value ?? '';
  }

  async update(key: string, value: string, updatedBy: string) {
    const existing = await prisma.systemParam.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException(`פרמטר "${key}" לא נמצא`);
    return prisma.systemParam.update({
      where: { key },
      data: { value, updatedBy },
    });
  }
}
