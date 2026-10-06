// Which environment this page is served from (2026-10-06).
// The production Docker image is built once and runs as both the production
// and the test environment on the same server, so "is this test?" can't be a
// build-time flag only: the frontend container writes /env-config.js at
// startup from its DC_ENV variable (see frontend/docker/40-dc-runtime.sh),
// and index.html loads it before the app. REACT_APP_ENV still works for the
// local dev servers (npm run start:test).
const runtimeEnv = (window as any).__DC_ENV as string | undefined;

export const IS_TEST = runtimeEnv === 'test' || process.env.REACT_APP_ENV === 'test';
