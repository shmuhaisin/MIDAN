// Runs before every end-to-end and live spec: the same env files the specs load, then the local-only check.
import { assertLocalStack } from '../src/common/local-stack';
import { loadEnv } from '../src/common/load-env';

loadEnv('.env', '.env.test.local');
assertLocalStack();
