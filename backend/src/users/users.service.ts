import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Emails that should always be preserved as admin accounts
const ADMIN_EMAILS = ['nissim@test.com', 'nisim@dev.com', 'hay@dev.com'];

// SECURITY NOTE: This SQL references internal schema names. Do not log or expose in responses.
const QC_USERS_SQL = `
  SELECT U.USER_NAME, U.FULL_NAME, U.EMAIL
  FROM QCSITEADMIN11_DB.USERS_PROJECTS UP
  JOIN QCSITEADMIN11_DB.USERS U ON UP.USER_ID = U.USER_ID
  JOIN QCSITEADMIN11_DB.PROJECTS P ON UP.PROJECT_ID = P.PROJECT_ID
  WHERE P.PROJECT_NAME = 'HOT_Wizard_IRB_Main'
    AND US_IS_ACTIVE = 'Y'
    AND EMAIL IS NOT NULL
    AND FULL_NAME IS NOT NULL
  ORDER BY U.USER_NAME
`;

interface QcUser { fullName: string; email: string; }

// SECURITY / PRIVACY NOTE:
// This list contains real employee PII (names and emails).
// It is a fallback for when Oracle is unavailable.
// TODO: Move this data to a database table or a gitignored config file.
//       Run "git filter-branch" or BFG Repo Cleaner to scrub it from git history if this repo is shared.
const HARDCODED_QC_USERS: QcUser[] = [
  { fullName: 'alick millionshik',      email: 'alick.millionshik@netcracker.com' },
  { fullName: 'Alin Dor',               email: 'Alin.Dor@hot.net.il' },
  { fullName: 'Alona Rozin',            email: 'Alona.Rozin@hot.net.il' },
  { fullName: 'Alona Shahak',           email: 'Alona.Shahak@hot.net.il' },
  { fullName: 'andrey',                 email: 'andreys@aman.co.il' },
  { fullName: 'Anna Leshem',            email: 'Anna.Leshem@hot.net.il' },
  { fullName: 'Asaf Golan',             email: 'aaf@ht.net.il' },
  { fullName: 'Asaf Soul',              email: 'Asaf.Soul@hot.net.il' },
  { fullName: 'Assaf Friedman',         email: 'Assaf.Friedman@hot.net.il' },
  { fullName: 'Avital Koren',           email: 'Avital.Koren@hot.net.il' },
  { fullName: 'Ayelet Amar',            email: 'ayelet.amar@hot.net.il' },
  { fullName: 'barak Ben-Dor',          email: 'Barak.Ben-Dor@hot.net.il' },
  { fullName: 'batsheva benjamin',      email: 'batsheva.benjamin@hot.net.il' },
  { fullName: 'Benny Toledo',           email: 'Benny.Toledo@hot.net.il' },
  { fullName: 'dana brosh',             email: 'dana.brosh@hot.net.il' },
  { fullName: 'Dan Braudo',             email: 'dan.braudo@NetCracker.com' },
  { fullName: 'daniel levi',            email: 'Daniel.Levi@hot.net.il' },
  { fullName: 'Devora Koffman',         email: 'Devora.Koffman@aman.co.il' },
  // #19 dtsapport — distribution list, skipped
  { fullName: 'dudi Meir',              email: 'Dudi.Meir@hot.net.il' },
  { fullName: 'Eduard Azar',            email: 'Eduard.Azar@hot.net.il' },
  { fullName: 'Eitan Grady',            email: 'Eitan.Grady@hot.net.il' },
  { fullName: 'eldad Almog',            email: 'Eldad.Almog@hot.net.il' },
  { fullName: 'eli cohen',              email: 'elic@hotmobile.co.il' },
  { fullName: 'Eli dekel',              email: 'Elid@hotmobile.co.il' },
  { fullName: 'eliran Hayoon',          email: 'Eliran.Hayoon@hot.net.il' },
  { fullName: 'elisheva Schlissel',     email: 'elishevas@aman.co.il' },
  { fullName: 'Evana Raed',             email: 'Evana.Raad@hot.net.il' },
  { fullName: 'Gilad Ben Natan',        email: 'Gilad.BenNatan@aman.co.il' },
  { fullName: 'Gila Pertzcovitz',       email: 'gilap@aman.co.il' },
  { fullName: 'Gilli Friefeld',         email: 'Gilli.Friefeld@hot.net.il' },
  { fullName: 'Golan Karni',            email: 'Golan.Karni@hot.net.il' },
  { fullName: 'Eliran gur',             email: 'Eliran.gur@hot.net.il' },
  { fullName: 'Guy Cohen',              email: 'Guy.Cohen2@hot.net.il' },
  { fullName: 'Guy Peled',              email: 'guy.peled@hot.net.il' },
  { fullName: 'Hananya Yeshayahu',      email: 'Hananya.Yeshayahu@hot.net.il' },
  { fullName: 'Hay Cohen',              email: 'Hay.Cohen@hot.net.il' },
  { fullName: 'hoday',                  email: 'hodayap@aman.co.il' },
  // #39 hsupport — distribution list, skipped
  { fullName: 'IBC Test Support',       email: 'integration@unlimited.net.il' },
  { fullName: 'Ida Furman',             email: 'Ida.Furman@hot.net.il' },
  { fullName: 'Idan Yehudai',           email: 'Idan.Yehoudaei@hot.net.il' },
  { fullName: 'Ido Arzil',              email: 'Ido.Arzil@hot.net.il' },
  { fullName: 'ilana pinhas',           email: 'Ilanap@hotmobile.co.il' },
  { fullName: 'Irena Rubinchik',        email: 'Irena.Rubinchik@hot.net.il' },
  { fullName: 'Irina Klebansky',        email: 'Irina.Klebansky@hot.net.il' },
  { fullName: 'Iris Shavit',            email: 'iris.shavit@hot.net.il' },
  { fullName: 'Ishay Peretz',           email: 'Ishay.Peretz@hot.net.il' },
  { fullName: 'Itamar Axelrad',         email: 'itamara@aman.co.il' },
  { fullName: 'Uri Izhak',              email: 'uri.izhak@hot.net.il' },
  { fullName: 'Joseph Abdallah',        email: 'Joseph.Abdallah@hot.net.il' },
  { fullName: 'Kaler lautaro',          email: 'Kaler.lautaro@hot.net.il' },
  { fullName: 'Kfir Bracha',            email: 'kfirb@aman.co.il' },
  { fullName: 'Kobi Goldenberg',        email: 'Kobi.Goldenberg@hot.net.il' },
  { fullName: 'Ksenia Nazarov',         email: 'ksenia.nazarov@hot.net.il' },
  { fullName: 'Laurent Berrebi',        email: 'Laurent.Berrebi@hot.net.il' },
  { fullName: 'Lena Bosis',             email: 'Lena.Bosis@hot.net.il' },
  { fullName: 'Lev Goldshmit',          email: 'Lev.Goldshmit@hot.net.il' },
  { fullName: 'Limor Kalchuk',          email: 'limor.kalchuk@NetCracker.com' },
  { fullName: 'Limor Pinhas',           email: 'Limor.Pinhas@hot.net.il' },
  { fullName: 'Lior Deckel',            email: 'Lior.Deckel@hot.net.il' },
  { fullName: 'Liran Abrahams',         email: 'Liran.Abrahams@hot.net.il' },
  { fullName: 'Maamon Alwan',           email: 'Alwan.Maamon@hot.net.il' },
  { fullName: 'Mazi Golestani',         email: 'Mazi.Golestani@hot.net.il' },
  { fullName: 'Meir Ptachia',           email: 'Meir.Ptachia@hot.net.il' },
  { fullName: 'Merav Amikam',           email: 'Merav.Amikam@hot.net.il' },
  { fullName: 'Michael Sagi',           email: 'michael.sagi@hot.net.il' },
  { fullName: 'michal Levi',            email: 'michalle@aman.co.il' },
  { fullName: 'Mohamad Zahrawe',        email: 'Mohamad.Zahrawe@hot.net.il' },
  { fullName: 'moshe shaul',            email: 'Moshe.Shaul@hot.net.il' },
  { fullName: 'Moshe Rahamim',          email: 'Moshe.Rahamim@hot.net.il' },
  { fullName: 'Natali Lotino',          email: 'Natali.Lotino@hot.net.il' },
  { fullName: 'Nathaniel Lichtenauer',  email: 'Nathaniel.Lichtenauer@hot.net.il' },
  { fullName: 'Nati volk',              email: 'Nattan.Volk@hot.net.il' },
  { fullName: 'Neta Maor',              email: 'netam@hotmobile.co.il' },
  { fullName: 'Netanel Mizrahi',        email: 'Netanel.Mizrahi@entrypoint.co.il' },
  { fullName: 'Nikol Grin',             email: 'Nikol.Grin@hot.net.il' },
  { fullName: 'Nir Shloman',            email: 'Nir.Shloman@aman.co.il' },
  { fullName: 'Nissim Peretz',          email: 'nissim.peretz@hot.net.il' },
  { fullName: 'Nitzan Weiss',           email: 'Nitzan.Weiss@hot.net.il' },
  { fullName: 'Noga Arieli',            email: 'Noga.Arieli@hot.net.il' },
  { fullName: 'Odelya Ezra',            email: 'odelya.ezra@hot.net.il' },
  { fullName: 'Odem Tabach',            email: 'Odem.Tabach@hot.net.il' },
  { fullName: 'Ofir Elias',             email: 'ofir.elias@hot.net.il' },
  { fullName: 'Ofir Turgeman',          email: 'Ofir.Turgeman@hot.net.il' },
  { fullName: 'Oleg Goverman',          email: 'Oleg.Goverman@hot.net.il' },
  { fullName: 'Omer BarEl',             email: 'Omer.BarEl@hot.net.il' },
  { fullName: 'Oren Bek',               email: 'oren.bek@ewave.co.il' },
  { fullName: 'Peter Shraga',           email: 'peter.shraga@hot.net.il' },
  { fullName: 'Pnina Alkichen',         email: 'Pnina.Alkichen@netcracker.com' },
  { fullName: 'pnina goldbrener',       email: 'pnina.goldbrener@netcracker.com' },
  { fullName: 'Pnina Yankowitch',       email: 'pnina.yankowitch@netcracker.com' },
  { fullName: 'Meital Provizor',        email: 'meital.provizor@hot.net.il' },
  { fullName: 'Rachel Elkarif',         email: 'rachel.elkarif@netcracker.com' },
  { fullName: 'Ran Segal',              email: 'ran.segal@netcracker.com' },
  { fullName: 'reut jacobsen',          email: 'reut.jacobsen@netcracker.com' },
  { fullName: 'roi vahab',              email: 'roi.vahab@hot.net.il' },
  { fullName: 'Ronen Otmy',             email: 'ronen.otmy@valorsolution.com' },
  { fullName: 'Rotem Golan',            email: 'Rotem.Golan@hot.net.il' },
  { fullName: 'Rotem Tavor',            email: 'rotemt@yaelgroup.com' },
  { fullName: 'Sagit Gortler',          email: 'sagit.gortler@hot.net.il' },
  { fullName: 'Samuel Krief',           email: 'Samuel.Krief@hot.net.il' },
  { fullName: 'Shalan Sham',            email: 'shalans@aman.co.il' },
  { fullName: 'Shani Ben Simon',        email: 'Shani.Ben.Simon@hot.net.il' },
  { fullName: 'shanic',                 email: 'shanic@aman.co.il' },
  { fullName: 'Shaul Keynan',           email: 'Shaul.Keynan@hot.net.il' },
  { fullName: 'sheindy yeger',          email: 'sheindy.yeger@netcracker.com' },
  { fullName: 'Shendi Waldman',         email: 'shendi.waldman@netcracker.com' },
  { fullName: 'Shira Nesher',           email: 'shira.nesher@netcracker.com' },
  { fullName: 'Shiran Sasunker',        email: 'shirans@hotmobile.co.il' },
  { fullName: 'Shir Shapira',           email: 'Shir.Shapira@hot.net.il' },
  { fullName: 'Shlomo Baevsky',         email: 'Shlomo.Baevsky@hot.net.il' },
  { fullName: 'Stanislav Abramyan',     email: 'Stanislav.Abramyan@hot.net.il' },
  { fullName: 'Talli Elishayov',        email: 'Talli.Elishayov@hot.net.il' },
  { fullName: 'Tamar Finkelstein',      email: 'tamar.finkelstein@netcracker.com' },
  { fullName: 'tamar',                  email: 'tamarw@aman.co.il' },
  { fullName: 'tamar weinberg',         email: 'tamarwe@aman.co.il' },
  { fullName: 'Tom Golan',              email: 'Tom.Golan@hot.net.il' },
  { fullName: 'Tomer Taub',             email: 'Tomer.Taub@hot.net.il' },
  { fullName: 'tsiki vaxberg',          email: 'Tsikiv@hotmobile.co.il' },
  { fullName: 'Udi SimanTov',           email: 'Udi.SimanTov@hot.net.il' },
  { fullName: 'Waled Samara',           email: 'Waled.Samara@hot.net.il' },
  { fullName: 'Yael Morgenstern Teff',  email: 'yael.morgensternteff@hot.net.il' },
  { fullName: 'Yael shahal',            email: 'yaelsha@aman.co.il' },
  { fullName: 'yael Vaishenshtern',     email: 'yaelv@aman.co.il' },
  { fullName: 'Yakov Chekol',           email: 'Yakov.Chekol@hot.net.il' },
  { fullName: 'Yaniv Zaarur',           email: 'Yaniv.Zaarur@hot.net.il' },
  { fullName: 'Yarden Barhcha',         email: 'Yarden.Barhcha@hot.net.il' },
  { fullName: 'yaron Fridler',          email: 'yaron.Fridler@hot.net.il' },
  { fullName: 'Yaron Glick',            email: 'Yaron.Glick@hot.net.il' },
  { fullName: 'Yoav Weiner',            email: 'Yoav.Weiner@hot.net.il' },
  { fullName: 'Yonathan Kivity',        email: 'Yonathan.Kivity@hot.net.il' },
  { fullName: 'Yoni Brakha',            email: 'Yoni.Brakha@hot.net.il' },
  { fullName: 'Yossi Farhi',            email: 'Yossi.Farhi@hot.net.il' },
  { fullName: 'Yossi Siton',            email: 'yossi.siton@hot.net.il' },
  { fullName: 'Yossi Shaby',            email: 'Yossi.Shaby@hot.net.il' },
  { fullName: 'Yulia Haya Kaspi',       email: 'YuliaHaya.Kaspi@netcracker.com' },
  { fullName: 'Yuval Nadler',           email: 'Yuval.Nadler@hot.net.il' },
  { fullName: 'Zeev Goldshtein',        email: 'Zeev.Goldshtein@hot.net.il' },
];

@Injectable()
export class UsersService {
  async findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  async findAll() {
    return prisma.user.findMany({
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        active: true,
        createdAt: true,
        teamMemberships: {
          include: {
            team: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { fullName: 'asc' },
    });
  }

  async create(data: {
    fullName: string;
    email: string;
    password: string;
    phone?: string;
    role?: string;
  }) {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    return prisma.user.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        password: hashedPassword,
        phone: data.phone,
        role: (data.role as any) || 'EMPLOYEE',
      },
    });
  }

  async update(id: string, data: { fullName?: string; role?: string; active?: boolean; phone?: string }) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return prisma.user.update({
      where: { id },
      data: data as any,
      select: { id: true, fullName: true, email: true, role: true, active: true, phone: true },
    });
  }

  async setTeam(userId: string, teamId: string | null) {
    // Remove from all current teams first
    await prisma.teamMember.deleteMany({ where: { userId } });
    if (teamId) {
      await prisma.teamMember.create({ data: { userId, teamId, isLead: false } });
    }
    return { ok: true };
  }

  async resetPassword(id: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id }, data: { password: hashedPassword } });
    return { ok: true };
  }

  async syncQcUsers(): Promise<{ created: number; updated: number; deactivated: number }> {
    const logger = new Logger('syncQcUsers');
    let qcUsers: QcUser[] = HARDCODED_QC_USERS;

    if (process.env.ORACLE_ENABLED === 'true') {
      try {
        const oracledb = await import('oracledb');
        oracledb.default.outFormat = oracledb.default.OUT_FORMAT_OBJECT;
        const conn = await oracledb.default.getConnection({
          user: process.env.ORACLE_USER,
          password: process.env.ORACLE_PASSWORD,
          connectString: process.env.ORACLE_CONNECT_STRING,
        });
        const result = await conn.execute(QC_USERS_SQL);
        await conn.close();
        qcUsers = (result.rows as any[]).map((r: any) => {
          const emails: string[] = (r.EMAIL as string).split(';').map((e: string) => e.trim()).filter(Boolean);
          return { fullName: r.FULL_NAME as string, email: emails[0] };
        }).filter((u: QcUser) => u.email);
        logger.log(`Fetched ${qcUsers.length} users from Oracle`);
      } catch (err: any) {
        // Log internally but do not expose Oracle error details outside this service
        logger.warn(`Oracle user sync failed — falling back to hardcoded list`);
        qcUsers = HARDCODED_QC_USERS;
      }
    }

    const adminEmailsLower = ADMIN_EMAILS.map(e => e.toLowerCase());
    const defaultPassword = await bcrypt.hash('123456', 10);

    let created = 0;
    let updated = 0;

    for (const qcUser of qcUsers) {
      const emailLower = qcUser.email.toLowerCase();
      if (adminEmailsLower.includes(emailLower)) continue;

      const existing = await prisma.user.findFirst({
        where: { email: { equals: qcUser.email, mode: 'insensitive' } },
      });
      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { fullName: qcUser.email.toLowerCase() === existing.email.toLowerCase() ? qcUser.fullName : existing.fullName, active: true },
        });
        updated++;
      } else {
        await prisma.user.create({
          data: { fullName: qcUser.fullName, email: qcUser.email, password: defaultPassword, role: 'EMPLOYEE', active: true },
        });
        created++;
      }
    }

    // Deactivate non-admin users not in the QC list
    const qcEmailsLower = new Set(qcUsers.map(u => u.email.toLowerCase()));
    const allUsers = await prisma.user.findMany({ where: { active: true } });
    let deactivated = 0;
    for (const u of allUsers) {
      if (adminEmailsLower.includes(u.email.toLowerCase())) continue;
      if (!qcEmailsLower.has(u.email.toLowerCase())) {
        await prisma.user.update({ where: { id: u.id }, data: { active: false } });
        deactivated++;
      }
    }

    logger.log(`QC user sync complete: created=${created}, updated=${updated}, deactivated=${deactivated}`);
    return { created, updated, deactivated };
  }
}
