/**
 * SMB/CIFS file reader with descriptive error handling.
 *
 * On Linux, SMB shares must be mounted via CIFS before the container starts.
 * This module reads from the mounted path and translates Linux errno codes
 * into clear, actionable error messages.
 *
 * Mount example (on RHEL host, before starting Docker):
 *   mount -t cifs "//hot-public-01/public/qa/automation/powerbi/releases" \
 *         /mnt/qc-releases \
 *         -o username=SMB_USERNAME,password=SMB_PASSWORD,domain=HOT,uid=1000,gid=1000
 *
 * Then in docker-compose.yml:
 *   volumes:
 *     - /mnt/qc-releases:/mnt/qc-releases:ro
 *   environment:
 *     QC_RELEASES_FILE: /mnt/qc-releases/cr_list.xls
 *
 * Alternatively, configure via SystemParam QC_RELEASES_FILE.
 */

import * as fs from 'fs';
import { Logger } from '@nestjs/common';

const logger = new Logger('SmbFileReader');

export interface SmbReadResult {
  buffer: Buffer;
  resolvedPath: string;
}

export class SmbAccessError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly filePath: string,
  ) {
    super(message);
    this.name = 'SmbAccessError';
  }
}

function classifyFsError(err: NodeJS.ErrnoException, filePath: string): SmbAccessError {
  const code = err.code ?? 'UNKNOWN';

  switch (code) {
    case 'ENOENT':
      return new SmbAccessError(
        `QC Releases file not found: ${filePath}\n` +
        'Verify:\n' +
        '  1. SMB share is mounted\n' +
        '  2. File cr_list.xls exists in the share\n' +
        '  3. QC_RELEASES_FILE path matches the actual mount point',
        code, filePath,
      );

    case 'EACCES':
    case 'EPERM':
      return new SmbAccessError(
        `Unable to access QC Releases file: ${filePath}\n` +
        'Reason: Access denied (NT_STATUS_ACCESS_DENIED)\n' +
        'Verify:\n' +
        '  1. SMB credentials are correct (SMB_USERNAME / SMB_PASSWORD)\n' +
        '  2. Mount includes correct uid/gid options\n' +
        '  3. Share permissions allow read access\n' +
        '  CIFS mount command: mount -t cifs "//SERVER/SHARE" /mnt/qc-releases \\\n' +
        '    -o username=USER,password=PASS,domain=HOT,uid=1000,gid=1000,file_mode=0444',
        code, filePath,
      );

    case 'ENOTCONN':
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
      return new SmbAccessError(
        `Cannot reach SMB server for QC Releases file: ${filePath}\n` +
        'Reason: Network/connection failure\n' +
        'Verify:\n' +
        '  1. SMB server (hot-public-01) is reachable from this host\n' +
        '  2. CIFS share is still mounted (mount | grep qc-releases)\n' +
        '  3. Re-mount if needed: mount -a',
        code, filePath,
      );

    case 'ESTALE':
      return new SmbAccessError(
        `SMB share became stale for: ${filePath}\n` +
        'Reason: NFS/CIFS stale file handle\n' +
        'Action: Unmount and remount the share:\n' +
        '  umount -f /mnt/qc-releases && mount -a',
        code, filePath,
      );

    case 'EISDIR':
      return new SmbAccessError(
        `Path is a directory, not a file: ${filePath}\n` +
        'Verify QC_RELEASES_FILE points to the actual .xls file, not a directory.',
        code, filePath,
      );

    default:
      return new SmbAccessError(
        `Failed to read QC Releases file: ${filePath}\n` +
        `Error code: ${code}\n` +
        `Details: ${err.message}`,
        code, filePath,
      );
  }
}

export function readQcFile(filePath: string): SmbReadResult {
  // Detect Windows paths and provide clear guidance
  if (/^[A-Za-z]:\\/.test(filePath)) {
    throw new SmbAccessError(
      `Invalid path on Linux: ${filePath}\n` +
      'Windows drive paths (X:\\...) cannot be used on Linux.\n' +
      'Mount the SMB share and use a Linux path:\n' +
      '  Example: /mnt/qc-releases/cr_list.xls',
      'WINDOWS_PATH', filePath,
    );
  }

  if (filePath.startsWith('\\\\')) {
    throw new SmbAccessError(
      `UNC path not directly supported on Linux: ${filePath}\n` +
      'Mount the SMB share via CIFS and use the mount point:\n' +
      '  mount -t cifs "//hot-public-01/public/qa/automation/powerbi/releases" \\\n' +
      '        /mnt/qc-releases \\\n' +
      '        -o username=USER,password=PASS,domain=HOT\n' +
      '  Then set QC_RELEASES_FILE=/mnt/qc-releases/cr_list.xls',
      'UNC_PATH', filePath,
    );
  }

  logger.log(`Reading QC file: ${filePath}`);

  try {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      throw new SmbAccessError(
        `Path is a directory, not a file: ${filePath}`,
        'EISDIR', filePath,
      );
    }
  } catch (err: any) {
    if (err instanceof SmbAccessError) throw err;
    throw classifyFsError(err, filePath);
  }

  try {
    const buffer = fs.readFileSync(filePath);
    logger.log(`QC file read OK: ${filePath} (${buffer.length} bytes)`);
    return { buffer, resolvedPath: filePath };
  } catch (err: any) {
    if (err instanceof SmbAccessError) throw err;
    throw classifyFsError(err, filePath);
  }
}

// Returns the configured QC releases file path.
// Resolution order: QC_RELEASES_FILE env → QC_RELEASES_FILE SystemParam → EXCEL_FILE_PATH SystemParam (legacy)
export async function resolveQcFilePath(prisma: any): Promise<string> {
  // 1. Environment variable (highest priority — Docker env / .env file)
  const envPath = process.env.QC_RELEASES_FILE?.trim();
  if (envPath) return envPath;

  // 2. SystemParam QC_RELEASES_FILE
  const newParam = await prisma.systemParam.findUnique({ where: { key: 'QC_RELEASES_FILE' } });
  if (newParam?.value?.trim()) return newParam.value.trim();

  // 3. Legacy SystemParam EXCEL_FILE_PATH
  const legacyParam = await prisma.systemParam.findUnique({ where: { key: 'EXCEL_FILE_PATH' } });
  if (legacyParam?.value?.trim()) return legacyParam.value.trim();

  throw new SmbAccessError(
    'נתיב קובץ QC Releases לא הוגדר.\n' +
    'הגדר באחת מהאפשרויות הבאות:\n' +
    '  1. משתנה סביבה: QC_RELEASES_FILE=/mnt/qc-releases/cr_list.xls\n' +
    '  2. SystemParam בפאנל הניהול: QC_RELEASES_FILE → /mnt/qc-releases/cr_list.xls\n' +
    '  לינוקס: mount את ה-SMB share לפני הפעלת הקונטיינר.',
    'NOT_CONFIGURED', '',
  );
}
