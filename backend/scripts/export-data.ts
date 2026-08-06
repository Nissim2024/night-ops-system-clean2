/**
 * DeployCenter — Data Export Script
 * Exports all Users, Teams, TeamMembers, RolePermissions, and SystemParams
 * from the current database to a JSON file for use during upgrade/migration.
 *
 * Usage (on current/source server):
 *   npx ts-node scripts/export-data.ts [output-file]
 *
 * Default output: ./deploycenter-data-export.json
 *
 * The output file can then be used with import-data.ts on the new server.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'prod'}`), override: true });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

interface ExportData {
  exportedAt: string;
  exportedBy: string;
  sourceVersion: string;
  users: any[];
  teams: any[];
  teamMembers: any[];
  rolePermissions: any[];
  systemParams: any[];
  versionTemplates: any[];
  skills: any[];
  testerProfiles: any[];
  testerSkills: any[];
}

async function main() {
  const outputFile = process.argv[2] ?? './deploycenter-data-export.json';

  console.log('DeployCenter Data Export');
  console.log(`  DB  : ${(process.env.DATABASE_URL ?? '').replace(/:\/\/.*@/, '://***@')}`);
  console.log(`  Out : ${path.resolve(outputFile)}`);
  console.log('');

  try {
    const [users, teams, teamMembers, rolePermissions, systemParams, versionTemplates, skills, testerProfiles, testerSkills] = await Promise.all([
      prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.team.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.teamMember.findMany(),
      prisma.rolePermissions.findMany(),
      prisma.systemParam.findMany({ orderBy: { key: 'asc' } }),
      prisma.versionTemplate.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.skill.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.testerProfile.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.testerSkill.findMany(),
    ]);

    // Same single-source-of-truth fix applied to health.controller.ts/main.ts/
    // docker-entrypoint.sh — this was hardcoded to '2.7.4' regardless of the
    // actual running version, silently mislabeling every export made since.
    const pkgVersion: string = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')).version ?? 'unknown';

    const data: ExportData = {
      exportedAt: new Date().toISOString(),
      exportedBy: process.env.USER ?? process.env.USERNAME ?? 'unknown',
      sourceVersion: pkgVersion,
      users,
      teams,
      teamMembers,
      rolePermissions,
      systemParams,
      versionTemplates,
      skills,
      testerProfiles,
      testerSkills,
    };

    fs.writeFileSync(outputFile, JSON.stringify(data, null, 2), 'utf8');

    console.log(`✅ Export complete:`);
    console.log(`   Users          : ${users.length}`);
    console.log(`   Teams          : ${teams.length}`);
    console.log(`   Team Members   : ${teamMembers.length}`);
    console.log(`   Role Perms     : ${rolePermissions.length}`);
    console.log(`   System Params  : ${systemParams.length}`);
    console.log(`   Templates      : ${versionTemplates.length}`);
    console.log(`   Skills         : ${skills.length}`);
    console.log(`   Tester Profiles: ${testerProfiles.length}`);
    console.log(`   Tester Skills  : ${testerSkills.length}`);
    console.log(`   File           : ${path.resolve(outputFile)}`);
    console.log('');
    console.log('Next step: copy deploycenter-data-export.json to the new server and run:');
    console.log('  npx ts-node scripts/import-data.ts deploycenter-data-export.json');
    console.log('Or set SEED_DATA_FILE in docker-compose.yml for automatic import on boot.');
  } catch (err: any) {
    console.error(`Export failed: ${err.message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
