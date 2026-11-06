export type EmployerVerificationStatus = 'verified_official' | 'pending_live_verification';
export type EmployerAliasStatus = 'official' | 'common' | 'ambiguous_manual_review' | 'common_manual_review';
export type ExternalEmployerMatchStatus = 'matched' | 'needs_review';

export type EmployerAlias = {
  value: string;
  language: 'ar' | 'en';
  status: EmployerAliasStatus;
};

export type EmployerRecord = {
  companyId: `ALM-${string}`;
  nameAr: string;
  nameEn: string;
  sector: string;
  sectorKey: string;
  officialWebsite: string;
  careerUrl?: string;
  verificationStatus: EmployerVerificationStatus;
  partnershipStatus: 'not_partner';
  aliases: readonly EmployerAlias[];
};

/** Reference entities from ALMIDAN_Employer_Database_10_Entities.xlsx.
 * These are not MIDAN organization accounts or partner records.
 */
export const EMPLOYER_REGISTRY: readonly EmployerRecord[] = [
  {
    companyId: 'ALM-001',
    nameAr: 'وزارة التجارة',
    nameEn: 'Ministry of Commerce',
    sector: 'Trade and regulation',
    sectorKey: 'trade',
    officialWebsite: 'https://mc.gov.sa',
    careerUrl: 'https://talent.mc.gov.sa/',
    verificationStatus: 'verified_official',
    partnershipStatus: 'not_partner',
    aliases: [{ value: 'وزارة التجارة', language: 'ar', status: 'official' }],
  },
  {
    companyId: 'ALM-002',
    nameAr: 'الهيئة العامة للترفيه',
    nameEn: 'General Entertainment Authority',
    sector: 'Entertainment',
    sectorKey: 'entertainment',
    officialWebsite: 'https://gea.gov.sa',
    verificationStatus: 'verified_official',
    partnershipStatus: 'not_partner',
    aliases: [{ value: 'هيئة الترفيه', language: 'ar', status: 'common' }],
  },
  {
    companyId: 'ALM-003',
    nameAr: 'شركة علم',
    nameEn: 'Elm Company',
    sector: 'Digital solutions',
    sectorKey: 'digital',
    officialWebsite: 'https://www.elm.sa',
    careerUrl: 'https://career.elm.sa/',
    verificationStatus: 'verified_official',
    partnershipStatus: 'not_partner',
    aliases: [{ value: 'علم', language: 'ar', status: 'common' }],
  },
  {
    companyId: 'ALM-004',
    nameAr: 'هيئة تطوير بوابة الدرعية',
    nameEn: 'Diriyah Gate Development Authority',
    sector: 'Heritage and urban development',
    sectorKey: 'heritage',
    officialWebsite: 'https://www.dgda.gov.sa',
    careerUrl: 'https://careers.dgda.gov.sa/',
    verificationStatus: 'verified_official',
    partnershipStatus: 'not_partner',
    aliases: [
      { value: 'بوابة الدرعية', language: 'ar', status: 'ambiguous_manual_review' },
      { value: 'هيئة تطوير بوابة الدرعية', language: 'ar', status: 'official' },
    ],
  },
  {
    companyId: 'ALM-005',
    nameAr: 'شركة الاتصالات السعودية (stc)',
    nameEn: 'Saudi Telecom Company (stc)',
    sector: 'Telecommunications',
    sectorKey: 'telecommunications',
    officialWebsite: 'https://www.stc.com.sa',
    careerUrl: 'https://www.stc.com.sa',
    verificationStatus: 'pending_live_verification',
    partnershipStatus: 'not_partner',
    aliases: [{ value: 'stc', language: 'ar', status: 'common' }],
  },
  {
    companyId: 'ALM-006',
    nameAr: 'الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا)',
    nameEn: 'Saudi Data and Artificial Intelligence Authority (SDAIA)',
    sector: 'Data and artificial intelligence',
    sectorKey: 'dataAi',
    officialWebsite: 'https://sdaia.gov.sa',
    verificationStatus: 'pending_live_verification',
    partnershipStatus: 'not_partner',
    aliases: [{ value: 'سدايا', language: 'ar', status: 'common' }],
  },
  {
    companyId: 'ALM-007',
    nameAr: 'شركة الصحراء العالمية للبتروكيماويات (سبكيم)',
    nameEn: 'Sahara International Petrochemical Company (Sipchem)',
    sector: 'Petrochemicals',
    sectorKey: 'petrochemicals',
    officialWebsite: 'https://sipchem.com',
    verificationStatus: 'pending_live_verification',
    partnershipStatus: 'not_partner',
    aliases: [{ value: 'سبكيم', language: 'ar', status: 'common' }],
  },
  {
    companyId: 'ALM-008',
    nameAr: 'الهيئة السعودية للبحر الأحمر',
    nameEn: 'Saudi Red Sea Authority',
    sector: 'Coastal tourism regulation',
    sectorKey: 'coastalTourism',
    officialWebsite: 'https://redsea.gov.sa',
    verificationStatus: 'pending_live_verification',
    partnershipStatus: 'not_partner',
    aliases: [{ value: 'هيئة البحر الأحمر', language: 'ar', status: 'common_manual_review' }],
  },
  {
    companyId: 'ALM-009',
    nameAr: 'وزارة المالية',
    nameEn: 'Ministry of Finance',
    sector: 'Public finance',
    sectorKey: 'publicFinance',
    officialWebsite: 'https://www.mof.gov.sa',
    verificationStatus: 'pending_live_verification',
    partnershipStatus: 'not_partner',
    aliases: [{ value: 'وزارة المالية', language: 'ar', status: 'common' }],
  },
  {
    companyId: 'ALM-010',
    nameAr: 'صندوق التنمية الصناعية السعودي',
    nameEn: 'Saudi Industrial Development Fund',
    sector: 'Industrial financing',
    sectorKey: 'industrialFinance',
    officialWebsite: 'https://www.sidf.gov.sa',
    verificationStatus: 'pending_live_verification',
    partnershipStatus: 'not_partner',
    aliases: [{ value: 'صندوق التنمية الصناعية', language: 'ar', status: 'common' }],
  },
] as const;

export type ExternalEmployerMatch = {
  /** A single likely registry group, even when the match still needs review. */
  candidateCompanyId: EmployerRecord['companyId'] | null;
  status: ExternalEmployerMatchStatus;
  reason:
    | 'confirmed_name_and_official_domain'
    | 'entity_verification_pending'
    | 'alias_needs_review'
    | 'official_domain_only'
    | 'name_only_or_aggregator_link'
    | 'conflicting_name_and_domain'
    | 'ambiguous_name'
    | 'no_match';
  entityVerificationStatus?: EmployerVerificationStatus;
};

const normalizeName = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[\p{P}\p{S}\s]/gu, '');

function domainFor(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLocaleLowerCase('en').replace(/^www\./, '');
  } catch {
    return null;
  }
}

function recordDomains(record: EmployerRecord): string[] {
  return [record.officialWebsite, record.careerUrl]
    .map(domainFor)
    .filter((domain): domain is string => domain !== null);
}

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Match exact employer names/aliases and source domains; never inspect job descriptions. */
export function matchExternalEmployer(input: {
  employerName?: string | null;
  postingUrl?: string | null;
  employerWebsite?: string | null;
}): ExternalEmployerMatch {
  const normalizedEmployer = input.employerName ? normalizeName(input.employerName) : '';
  const nameMatches = EMPLOYER_REGISTRY.flatMap((record) => {
    const primaryNames = [record.nameAr, record.nameEn].map(normalizeName);
    const alias = record.aliases.find((item) => normalizeName(item.value) === normalizedEmployer);
    if (!normalizedEmployer || (!primaryNames.includes(normalizedEmployer) && !alias)) return [];
    return [{ record, alias }];
  });

  const hosts = [domainFor(input.postingUrl ?? undefined), domainFor(input.employerWebsite ?? undefined)]
    .filter((host): host is string => host !== null);
  const domainMatches = EMPLOYER_REGISTRY.filter((record) =>
    hosts.some((host) => recordDomains(record).some((domain) => hostMatchesDomain(host, domain))),
  );

  const nameIds = [...new Set(nameMatches.map(({ record }) => record.companyId))];
  const domainIds = [...new Set(domainMatches.map((record) => record.companyId))];

  if (nameIds.length > 1 || domainIds.length > 1) {
    return { candidateCompanyId: null, status: 'needs_review', reason: 'ambiguous_name' };
  }

  const nameId = nameIds[0];
  const domainId = domainIds[0];
  if (nameId && domainId && nameId !== domainId) {
    return { candidateCompanyId: null, status: 'needs_review', reason: 'conflicting_name_and_domain' };
  }

  const candidateId = nameId ?? domainId;
  if (!candidateId) return { candidateCompanyId: null, status: 'needs_review', reason: 'no_match' };

  const record = EMPLOYER_REGISTRY.find((item) => item.companyId === candidateId)!;
  const nameMatch = nameMatches.find(({ record: item }) => item.companyId === candidateId);
  const isCanonicalName = !!nameMatch &&
    [record.nameAr, record.nameEn].some((name) => normalizeName(name) === normalizedEmployer);
  const hasOfficialDomain = domainId === candidateId;

  if (record.verificationStatus !== 'verified_official') {
    return {
      candidateCompanyId: candidateId,
      status: 'needs_review',
      reason: 'entity_verification_pending',
      entityVerificationStatus: record.verificationStatus,
    };
  }

  if (nameMatch?.alias && nameMatch.alias.status !== 'official') {
    return {
      candidateCompanyId: candidateId,
      status: 'needs_review',
      reason: 'alias_needs_review',
      entityVerificationStatus: record.verificationStatus,
    };
  }

  if (isCanonicalName && hasOfficialDomain) {
    return {
      candidateCompanyId: candidateId,
      status: 'matched',
      reason: 'confirmed_name_and_official_domain',
      entityVerificationStatus: record.verificationStatus,
    };
  }

  return {
    candidateCompanyId: candidateId,
    status: 'needs_review',
    reason: hasOfficialDomain ? 'official_domain_only' : 'name_only_or_aggregator_link',
    entityVerificationStatus: record.verificationStatus,
  };
}
