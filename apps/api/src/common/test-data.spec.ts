import { isFixtureAccount, listableJobs, viewableJob } from './test-data';

describe('test organizations stay with the test accounts', () => {
  it('recognises only the synthetic test addresses', () => {
    expect(isFixtureAccount('midan.test.candidate-one@example.com')).toBe(true);
    expect(isFixtureAccount('someone@gmail.com')).toBe(false);
    expect(isFixtureAccount('midan.test.x@example.org')).toBe(false);
    expect(isFixtureAccount(undefined)).toBe(false);
  });

  it('hides a test organization\'s job by direct ID from anonymous visitors and real accounts', () => {
    expect(viewableJob('j1')).toEqual({ id: 'j1', organizations: { is_test: false } });
    expect(viewableJob('j1', 'someone@gmail.com')).toEqual({ id: 'j1', organizations: { is_test: false } });
  });

  it('lets the test accounts open test jobs, as listings do', () => {
    expect(viewableJob('j1', 'midan.test.candidate-one@example.com')).toEqual({ id: 'j1' });
    expect(listableJobs('midan.test.candidate-one@example.com').organizations).toEqual({ is_demo: false });
    expect(listableJobs().organizations).toEqual({ is_demo: false, is_test: false });
  });
});
