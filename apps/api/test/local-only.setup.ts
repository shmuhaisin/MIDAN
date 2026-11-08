// Runs before every end-to-end and live spec: the same env files the specs load, then the local-only check.
import { assertLocalStack } from '../src/common/local-stack';
import { loadEnv } from '../src/common/load-env';

loadEnv('.env', '.env.test.local');
assertLocalStack();

// The demo .env may hold real Daily and Google Calendar credentials. Tests never use them: a spec that needs video or a
// calendar sets local stand-ins itself, so no test creates a real room or a real event, or emails anyone. They are blanked,
// not deleted, because loadEnv (which each spec calls again) only fills in variables that are unset.
for (const key of ['DAILY_API_KEY', 'GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'GOOGLE_CALENDAR_REFRESH_TOKEN']) process.env[key] = '';
for (const key of ['DAILY_API_URL', 'GOOGLE_API_URL', 'GOOGLE_TOKEN_URL']) delete process.env[key];
