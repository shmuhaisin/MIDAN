import clsx from 'clsx';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Arrow, Eyebrow, Humaidan, Parapet } from '@/components/brand';
import { WithdrawButton } from '@/components/forms';
import { Link, redirect } from '@/i18n/navigation';
import { apiForPage } from '@/lib/api';
import { pick } from '@/lib/format';
import { getSession } from '@/lib/session';

type Me = {
  display_name: string | null; email: string;
  candidate_profiles: { full_name: string; headline: string | null } | null;
  organization_members: { org_id: string; role: string; organizations: { name_ar: string; name_en: string; is_demo: boolean } }[];
};
type MyApplication = {
  id: string; status: string;
  jobs: { id: string; title_ar: string; title_en: string; is_demo: boolean; organizations: { name_ar: string; name_en: string } };
};

const JOURNEY = ['submitted', 'under_review', 'assessment_invited', 'assessment_in_progress', 'assessment_submitted', 'evaluated'];

function Progress({ status }: { status: string }) {
  const reached = ['shortlisted', 'hired'].includes(status) ? JOURNEY.length : JOURNEY.indexOf(status) + 1;
  return (
    <span aria-hidden className="flex items-end gap-0.5">
      {JOURNEY.map((step, i) => (
        <span key={step} style={{ height: `${6 + i * 3}px` }} className={clsx('w-3 rounded-t-sm', i < reached ? 'bg-primary' : 'bg-surface-2')} />
      ))}
    </span>
  );
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) return redirect({ href: '/login', locale });
  const [me, applications] = await Promise.all([apiForPage<Me>('/me'), apiForPage<MyApplication[]>('/me/applications')]);
  if (!me || !applications) return redirect({ href: '/login', locale });
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const ts = await getTranslations({ locale, namespace: 'applicationStatus' });

  const name = me.candidate_profiles?.full_name ?? me.display_name ?? me.email;
  const isOrgFirst = session.accountType === 'organization';
  const active = applications.filter((a) => a.status !== 'withdrawn');
  const firstOrg = me.organization_members[0];
  const next = active.some((a) => a.status === 'assessment_invited')
    ? { title: t('nextInvitedTitle'), body: t('nextInvitedBody') }
    : firstOrg && applications.length === 0
      ? { title: t('nextOrgTitle'), body: t('nextOrgBody'), cta: t('openOrganization'), href: `/organization/${firstOrg.org_id}` }
      : !me.candidate_profiles && !isOrgFirst
      ? { title: t('nextProfileTitle'), body: t('nextProfileBody'), cta: t('nextProfileCta'), href: '/profile' }
      : active.length === 0 && !isOrgFirst
        ? { title: t('nextBrowseTitle'), body: t('nextBrowseBody'), cta: t('nextBrowseCta'), href: '/opportunities' }
        : isOrgFirst && me.organization_members.length === 0
          ? { title: t('createOrganization'), body: t('createOrganizationBody'), cta: t('createOrganization'), href: '/organization/new' }
          : { title: t('nextTrackTitle'), body: t('nextTrackBody'), cta: t('nextTrackCta'), href: '/opportunities' };

  return (
    <>
      <section className="mx-auto grid max-w-6xl items-end gap-6 px-4 pt-10 sm:px-6 md:grid-cols-[1fr_auto]">
        <div className="pb-8">
          <p className="text-lg text-muted">{t('hello', { name })}</p>
          <Eyebrow className="mt-6 text-muted">{t('nextEyebrow')}</Eyebrow>
          <h1 className="mt-3 max-w-2xl font-display text-4xl leading-tight font-bold sm:text-5xl">{next.title}</h1>
          <p className="mt-3 max-w-xl text-lg leading-relaxed text-muted">{next.body}</p>
          {next.href && (
            <Link href={next.href} className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5">
              {next.cta}<Arrow />
            </Link>
          )}
        </div>
        <div className="mx-auto w-36 md:w-44"><Humaidan sizes="176px" priority /></div>
      </section>
      <Parapet className="text-deep" />

      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="my-applications">
          <h2 id="my-applications" className="font-display text-2xl font-bold">{t('applications')}</h2>
          {applications.length === 0 ? (
            <p className="mt-4 text-muted">{t('noApplications')}</p>
          ) : (
            <ul className="mt-4 border-t border-border">
              {applications.map((a) => (
                <li key={a.id} className="border-b border-border py-5">
                  <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                    <div className="min-w-0">
                      <Link href={`/opportunities/${a.jobs.id}`} className="font-semibold hover:text-primary">{pick(locale, a.jobs.title_ar, a.jobs.title_en)}</Link>
                      <p className="text-sm text-muted">{pick(locale, a.jobs.organizations.name_ar, a.jobs.organizations.name_en)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{ts(a.status)}</span>
                      {!['withdrawn', 'rejected'].includes(a.status) && <Progress status={a.status} />}
                    </div>
                  </div>
                  {!['withdrawn', 'rejected', 'hired'].includes(a.status) && <div className="mt-2"><WithdrawButton id={a.id} /></div>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-10">
          <section>
            <h2 className="font-display text-xl font-bold">{t('profile')}</h2>
            {me.candidate_profiles && (
              <p className="mt-2">
                <span className="font-medium">{me.candidate_profiles.full_name}</span>
                {me.candidate_profiles.headline && <span className="block text-sm text-muted">{me.candidate_profiles.headline}</span>}
              </p>
            )}
            <Link href="/profile" className="mt-2 inline-block font-semibold text-primary underline underline-offset-4">{t('editProfile')}</Link>
          </section>
          <section>
            <h2 className="font-display text-xl font-bold">{t('organizations')}</h2>
            <ul className="mt-2 space-y-3">
              {me.organization_members.map((m) => (
                <li key={m.org_id}>
                  <Link href={`/organization/${m.org_id}`} className="group flex items-center justify-between gap-3 font-medium hover:text-primary">
                    <span>
                      {pick(locale, m.organizations.name_ar, m.organizations.name_en)}
                      <span className="block text-sm font-normal text-muted">{t(`role.${m.role}`)}</span>
                    </span>
                    <Arrow />
                  </Link>
                </li>
              ))}
            </ul>
            {me.organization_members.length === 0 && <p className="mt-2 text-sm text-muted">{t('createOrganizationBody')}</p>}
            <Link href="/organization/new" className="mt-3 inline-block font-semibold text-primary underline underline-offset-4">{t('createOrganization')}</Link>
          </section>
        </aside>
      </div>
    </>
  );
}
