import { assertLocalStack, nonLocalSettings } from './local-stack';

describe('the local-only guard for test suites', () => {
  const local = {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', DATABASE_URL: 'postgresql://midan_api:x@127.0.0.1:54322/midan',
    API_URL: 'http://localhost:4000', AI_SERVICE_URL: 'http://[::1]:8000',
  };

  it('accepts a stack that is entirely on this machine', () => {
    expect(nonLocalSettings(local)).toEqual([]);
    expect(() => assertLocalStack(local)).not.toThrow();
  });

  it('refuses hosted addresses, naming the setting and never its value', () => {
    const hosted = { ...local, NEXT_PUBLIC_SUPABASE_URL: 'https://example-project.supabase.co', DIRECT_URL: 'postgresql://postgres:secret-value@aws-0-eu.pooler.supabase.com:5432/postgres' };
    expect(nonLocalSettings(hosted)).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'DIRECT_URL']);
    expect(() => assertLocalStack(hosted)).toThrow(/NEXT_PUBLIC_SUPABASE_URL, DIRECT_URL/);
    expect(() => assertLocalStack(hosted)).not.toThrow(/secret-value|supabase\.co/);
  });

  it('refuses a value it cannot read rather than guessing', () => {
    expect(nonLocalSettings({ DATABASE_URL: 'not a url' })).toEqual(['DATABASE_URL']);
  });
});
