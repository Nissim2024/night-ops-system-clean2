/**
 * Oracle Thick Mode initialization — must be called ONCE before any oracledb connection.
 * Oracle 11g requires Thick Mode (Thin Mode is not supported for 11.2.x).
 *
 * Required env var: ORACLE_LIB_DIR — path to directory containing libclntsh.so
 * Example: ORACLE_LIB_DIR=/oracle/lib
 */

let initialized = false;

export interface OracleInitResult {
  mode: 'THICK' | 'DISABLED';
  version?: string;
  libDir?: string;
}

export function initOracleThickMode(): OracleInitResult {
  if (initialized) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const oracledb = require('oracledb');
    return {
      mode: 'THICK',
      version: oracledb.oracleClientVersionString ?? 'unknown',
    };
  }

  const libDir = process.env.ORACLE_LIB_DIR?.trim();
  if (!libDir) {
    throw new Error(
      'Oracle Client not configured.\n' +
      'Set ORACLE_LIB_DIR to the directory containing libclntsh.so.\n' +
      'Example: ORACLE_LIB_DIR=/oracle/lib\n' +
      'Docker: mount the Oracle Client lib dir as a volume and set ORACLE_LIB_DIR.'
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const oracledb = require('oracledb');

  try {
    oracledb.initOracleClient({ libDir });
  } catch (err: any) {
    throw new Error(
      `Oracle Thick Mode initialization failed: ${err.message}\n` +
      `ORACLE_LIB_DIR=${libDir}\n` +
      `Verify that libclntsh.so exists in that directory and libaio is installed.`
    );
  }

  if (oracledb.thin === true) {
    throw new Error(
      'Oracle is still in Thin Mode after initOracleClient().\n' +
      `ORACLE_LIB_DIR=${libDir}\n` +
      'Oracle 11g requires Thick Mode. Verify the Oracle Client library is accessible.'
    );
  }

  initialized = true;
  const version: string = oracledb.oracleClientVersionString ?? 'unknown';

  return { mode: 'THICK', version, libDir };
}

export function isOracleThickInitialized(): boolean {
  return initialized;
}
