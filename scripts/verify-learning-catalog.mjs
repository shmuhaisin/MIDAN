// Builds MIDAN's verified course and certification catalog (public.learning_resources) from official pages.
//
//   node scripts/verify-learning-catalog.mjs                 check every entry and write the ones that pass (local database)
//   node scripts/verify-learning-catalog.mjs --dry-run       check only, write nothing
//   CATALOG_DATABASE_URL=postgres://... node scripts/...     another database (a platform administrator's decision)
//
// An entry is written only when its official page answers 200, the page's title names it (the `expect` pattern), and the
// page doesn't say it was retired or is no longer offered. What was checked is stored with it (verification, verified_on).
// Nothing else on the page is claimed: duration and cost stay empty unless set here from the official page, and the screen
// sends the reader to the official link for them. An entry that fails any check is reported and left out, never guessed.
// Career readiness recommends only entries in this catalog, by id.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dry = process.argv.includes('--dry-run');

const ENTRIES = [
  // Data and analytics
  { kind: 'certification', title_en: 'Microsoft Certified: Power BI Data Analyst Associate (PL-300)', title_ar: 'شهادة مايكروسوفت: محلل بيانات Power BI المعتمد (PL-300)', provider: 'Microsoft', url: 'https://learn.microsoft.com/en-us/credentials/certifications/data-analyst-associate/', expect: /Power BI Data Analyst/i, level: 'intermediate', skills_en: ['Power BI', 'data modeling', 'DAX', 'dashboards', 'data visualization'], skills_ar: ['Power BI', 'نمذجة البيانات', 'لوحات المتابعة', 'تصوير البيانات'], target_roles: ['data analyst', 'business intelligence analyst', 'reporting analyst'] },
  { kind: 'course', title_en: 'Google Data Analytics Professional Certificate', title_ar: 'شهادة Google المهنية في تحليل البيانات', provider: 'Google (Coursera)', url: 'https://www.coursera.org/professional-certificates/google-data-analytics', expect: /Google Data Analytics/i, level: 'beginner', skills_en: ['SQL', 'spreadsheets', 'Tableau', 'R', 'data cleaning', 'data visualization'], skills_ar: ['SQL', 'الجداول الحسابية', 'تنظيف البيانات', 'تصوير البيانات'], target_roles: ['data analyst', 'junior data analyst'] },
  { kind: 'course', title_en: 'Google Advanced Data Analytics Professional Certificate', title_ar: 'شهادة Google المهنية المتقدمة في تحليل البيانات', provider: 'Google (Coursera)', url: 'https://www.coursera.org/professional-certificates/google-advanced-data-analytics', expect: /Advanced Data Analytics/i, level: 'advanced', skills_en: ['Python', 'statistics', 'regression', 'machine learning', 'hypothesis testing'], skills_ar: ['بايثون', 'الإحصاء', 'الانحدار', 'تعلم الآلة', 'اختبار الفرضيات'], target_roles: ['data analyst', 'data scientist'] },
  { kind: 'course', title_en: 'IBM Data Analyst Professional Certificate', title_ar: 'شهادة IBM المهنية لمحلل البيانات', provider: 'IBM (Coursera)', url: 'https://www.coursera.org/professional-certificates/ibm-data-analyst', expect: /IBM Data Analyst/i, level: 'beginner', skills_en: ['Excel', 'SQL', 'Python', 'data visualization', 'dashboards'], skills_ar: ['إكسل', 'SQL', 'بايثون', 'لوحات المتابعة'], target_roles: ['data analyst'] },
  { kind: 'course', title_en: 'SQL for Data Science', title_ar: 'SQL لعلم البيانات', provider: 'University of California, Davis (Coursera)', url: 'https://www.coursera.org/learn/sql-for-data-science', expect: /SQL for Data Science/i, level: 'beginner', skills_en: ['SQL', 'joins', 'aggregation', 'subqueries'], skills_ar: ['SQL', 'ربط الجداول', 'التجميع'], target_roles: ['data analyst', 'business analyst'] },
  { kind: 'course', title_en: 'Intro to SQL', title_ar: 'مقدمة في SQL', provider: 'Kaggle Learn', url: 'https://www.kaggle.com/learn/intro-to-sql', expect: /SQL/i, level: 'beginner', skills_en: ['SQL', 'queries', 'aggregation'], skills_ar: ['SQL', 'الاستعلامات'], target_roles: ['data analyst'] },
  { kind: 'certification', title_en: 'Microsoft Certified: Azure Data Fundamentals (DP-900)', title_ar: 'شهادة مايكروسوفت: أساسيات بيانات Azure (DP-900)', provider: 'Microsoft', url: 'https://learn.microsoft.com/en-us/credentials/certifications/azure-data-fundamentals/', expect: /Azure Data Fundamentals/i, level: 'beginner', skills_en: ['relational data', 'non-relational data', 'data analytics on Azure'], skills_ar: ['قواعد البيانات العلائقية', 'تحليلات البيانات على Azure'], target_roles: ['data analyst', 'data engineer'] },
  { kind: 'course', title_en: 'Python for Everybody Specialization', title_ar: 'تخصص بايثون للجميع', provider: 'University of Michigan (Coursera)', url: 'https://www.coursera.org/specializations/python', expect: /Python for Everybody/i, level: 'beginner', skills_en: ['Python', 'data structures', 'web data', 'databases'], skills_ar: ['بايثون', 'هياكل البيانات', 'قواعد البيانات'], target_roles: ['data analyst', 'software developer'] },
  { kind: 'course', title_en: 'Machine Learning Specialization', title_ar: 'تخصص تعلم الآلة', provider: 'DeepLearning.AI and Stanford University (Coursera)', url: 'https://www.coursera.org/specializations/machine-learning-introduction', expect: /Machine Learning/i, level: 'intermediate', skills_en: ['machine learning', 'regression', 'classification', 'neural networks'], skills_ar: ['تعلم الآلة', 'الانحدار', 'التصنيف'], target_roles: ['data scientist', 'machine learning engineer'] },
  // Cloud and software
  { kind: 'certification', title_en: 'AWS Certified Cloud Practitioner', title_ar: 'شهادة AWS ممارس سحابي معتمد', provider: 'Amazon Web Services', url: 'https://aws.amazon.com/certification/certified-cloud-practitioner/', expect: /Cloud Practitioner/i, level: 'beginner', skills_en: ['cloud concepts', 'AWS services', 'security', 'pricing'], skills_ar: ['مفاهيم الحوسبة السحابية', 'خدمات AWS'], target_roles: ['cloud engineer', 'software developer', 'it support'] },
  { kind: 'certification', title_en: 'AWS Certified Solutions Architect – Associate', title_ar: 'شهادة AWS مهندس حلول معتمد – مشارك', provider: 'Amazon Web Services', url: 'https://aws.amazon.com/certification/certified-solutions-architect-associate/', expect: /Solutions Architect/i, level: 'intermediate', skills_en: ['cloud architecture', 'AWS', 'high availability', 'security'], skills_ar: ['معمارية الحوسبة السحابية', 'AWS'], target_roles: ['cloud engineer', 'solutions architect'] },
  { kind: 'certification', title_en: 'Microsoft Certified: Azure Fundamentals (AZ-900)', title_ar: 'شهادة مايكروسوفت: أساسيات Azure (AZ-900)', provider: 'Microsoft', url: 'https://learn.microsoft.com/en-us/credentials/certifications/azure-fundamentals/', expect: /Azure Fundamentals/i, level: 'beginner', skills_en: ['cloud concepts', 'Azure services', 'governance'], skills_ar: ['مفاهيم الحوسبة السحابية', 'خدمات Azure'], target_roles: ['cloud engineer', 'it support'] },
  { kind: 'certification', title_en: 'Google Cloud Associate Cloud Engineer', title_ar: 'شهادة Google Cloud مهندس سحابي مشارك', provider: 'Google Cloud', url: 'https://cloud.google.com/learn/certification/cloud-engineer', expect: /Cloud Engineer/i, level: 'intermediate', skills_en: ['Google Cloud', 'deployment', 'operations', 'IAM'], skills_ar: ['Google Cloud', 'النشر', 'التشغيل'], target_roles: ['cloud engineer'] },
  { kind: 'course', title_en: 'Meta Front-End Developer Professional Certificate', title_ar: 'شهادة Meta المهنية لمطور الواجهات الأمامية', provider: 'Meta (Coursera)', url: 'https://www.coursera.org/professional-certificates/meta-front-end-developer', expect: /Front-End Developer/i, level: 'beginner', skills_en: ['HTML', 'CSS', 'JavaScript', 'React', 'UX basics'], skills_ar: ['HTML', 'CSS', 'جافاسكربت', 'React'], target_roles: ['front-end developer', 'software developer', 'web developer'] },
  { kind: 'course', title_en: "CS50's Introduction to Computer Science", title_ar: 'مقدمة CS50 في علوم الحاسب', provider: 'Harvard University', url: 'https://cs50.harvard.edu/x/', expect: /CS50/i, level: 'beginner', skills_en: ['programming', 'algorithms', 'C', 'Python', 'SQL', 'web development'], skills_ar: ['البرمجة', 'الخوارزميات', 'بايثون', 'SQL'], target_roles: ['software developer', 'software engineer'] },
  { kind: 'course', title_en: 'Google IT Support Professional Certificate', title_ar: 'شهادة Google المهنية للدعم التقني', provider: 'Google (Coursera)', url: 'https://www.coursera.org/professional-certificates/google-it-support', expect: /IT Support/i, level: 'beginner', skills_en: ['troubleshooting', 'networking', 'operating systems', 'customer service'], skills_ar: ['حل المشكلات التقنية', 'الشبكات', 'أنظمة التشغيل'], target_roles: ['it support', 'help desk'] },
  // Cybersecurity
  { kind: 'certification', title_en: 'CompTIA Security+', title_ar: 'شهادة CompTIA Security+', provider: 'CompTIA', url: 'https://www.comptia.org/certifications/security', expect: /Security\+/i, level: 'intermediate', skills_en: ['threats and vulnerabilities', 'security operations', 'risk management', 'network security'], skills_ar: ['التهديدات والثغرات', 'عمليات الأمن', 'إدارة المخاطر'], target_roles: ['cybersecurity analyst', 'security engineer', 'soc analyst'] },
  { kind: 'course', title_en: 'Google Cybersecurity Professional Certificate', title_ar: 'شهادة Google المهنية في الأمن السيبراني', provider: 'Google (Coursera)', url: 'https://www.coursera.org/professional-certificates/google-cybersecurity', expect: /Cybersecurity/i, level: 'beginner', skills_en: ['security operations', 'SIEM', 'Linux', 'Python', 'incident response'], skills_ar: ['عمليات الأمن', 'الاستجابة للحوادث', 'لينكس'], target_roles: ['cybersecurity analyst', 'soc analyst'] },
  { kind: 'certification', title_en: 'ISC2 Certified in Cybersecurity (CC)', title_ar: 'شهادة ISC2 معتمد في الأمن السيبراني (CC)', provider: 'ISC2', url: 'https://www.isc2.org/certifications/cc', expect: /Certified in Cybersecurity|\bCC\b/i, level: 'beginner', skills_en: ['security principles', 'access control', 'network security', 'security operations'], skills_ar: ['مبادئ الأمن', 'التحكم في الوصول', 'أمن الشبكات'], target_roles: ['cybersecurity analyst'] },
  { kind: 'certification', title_en: 'CISSP – Certified Information Systems Security Professional', title_ar: 'شهادة CISSP لمحترفي أمن نظم المعلومات', provider: 'ISC2', url: 'https://www.isc2.org/certifications/cissp', expect: /CISSP/i, level: 'advanced', prerequisites: 'ISC2 states a requirement of paid work experience in its security domains; see the official page.', skills_en: ['security architecture', 'risk management', 'identity and access management', 'security operations'], skills_ar: ['معمارية الأمن', 'إدارة المخاطر', 'إدارة الهوية والوصول'], target_roles: ['security manager', 'security architect'] },
  // Project management, business
  { kind: 'course', title_en: 'Google Project Management Professional Certificate', title_ar: 'شهادة Google المهنية في إدارة المشاريع', provider: 'Google (Coursera)', url: 'https://www.coursera.org/professional-certificates/google-project-management', expect: /Project Management/i, level: 'beginner', skills_en: ['project planning', 'agile', 'scrum', 'risk management', 'stakeholder management'], skills_ar: ['تخطيط المشاريع', 'أجايل', 'سكرم', 'إدارة المخاطر'], target_roles: ['project manager', 'project coordinator'] },
  { kind: 'certification', title_en: 'Project Management Professional (PMP)', title_ar: 'شهادة محترف إدارة المشاريع (PMP)', provider: 'Project Management Institute', url: 'https://www.pmi.org/certifications/project-management-pmp', expect: /PMP|Project Management Professional/i, level: 'advanced', prerequisites: 'PMI states project experience and training requirements; see the official page.', skills_en: ['project management', 'agile and hybrid approaches', 'stakeholder management'], skills_ar: ['إدارة المشاريع', 'المنهجيات الرشيقة والهجينة'], target_roles: ['project manager'] },
  { kind: 'course', title_en: 'Google UX Design Professional Certificate', title_ar: 'شهادة Google المهنية في تصميم تجربة المستخدم', provider: 'Google (Coursera)', url: 'https://www.coursera.org/professional-certificates/google-ux-design', expect: /UX Design/i, level: 'beginner', skills_en: ['user research', 'wireframing', 'prototyping', 'Figma', 'usability testing'], skills_ar: ['أبحاث المستخدم', 'النماذج الأولية', 'اختبار قابلية الاستخدام'], target_roles: ['ux designer', 'product designer'] },
  { kind: 'course', title_en: 'Google Digital Marketing & E-commerce Professional Certificate', title_ar: 'شهادة Google المهنية في التسويق الرقمي والتجارة الإلكترونية', provider: 'Google (Coursera)', url: 'https://www.coursera.org/professional-certificates/google-digital-marketing-ecommerce', expect: /Digital Marketing/i, level: 'beginner', skills_en: ['digital marketing', 'SEO', 'SEM', 'email marketing', 'e-commerce', 'analytics'], skills_ar: ['التسويق الرقمي', 'تحسين محركات البحث', 'التجارة الإلكترونية'], target_roles: ['digital marketing specialist', 'marketing coordinator'] },
  { kind: 'course', title_en: 'Inbound Marketing', title_ar: 'التسويق الداخلي (Inbound)', provider: 'HubSpot Academy', url: 'https://academy.hubspot.com/courses/inbound-marketing', expect: /Inbound Marketing/i, level: 'beginner', skills_en: ['content marketing', 'inbound marketing', 'lead nurturing'], skills_ar: ['تسويق المحتوى', 'رعاية العملاء المحتملين'], target_roles: ['marketing coordinator', 'digital marketing specialist'] },
  // Finance, supply chain, HR
  { kind: 'certification', title_en: 'CFA Program', title_ar: 'برنامج المحلل المالي المعتمد (CFA)', provider: 'CFA Institute', url: 'https://www.cfainstitute.org/programs/cfa-program', expect: /CFA/i, level: 'advanced', skills_en: ['investment analysis', 'financial reporting', 'portfolio management', 'ethics'], skills_ar: ['تحليل الاستثمار', 'التقارير المالية', 'إدارة المحافظ'], target_roles: ['financial analyst', 'investment analyst'] },
  { kind: 'certification', title_en: 'ASCM Certified Supply Chain Professional (CSCP)', title_ar: 'شهادة ASCM محترف سلاسل الإمداد المعتمد (CSCP)', provider: 'ASCM', url: 'https://www.ascm.org/learning-development/certifications-credentials/cscp/', expect: /CSCP|Supply Chain Professional/i, level: 'advanced', skills_en: ['supply chain design', 'planning', 'logistics', 'supplier relationships'], skills_ar: ['تصميم سلاسل الإمداد', 'التخطيط', 'الخدمات اللوجستية'], target_roles: ['supply chain analyst', 'supply chain manager'] },
  { kind: 'certification', title_en: 'SHRM Certified Professional (SHRM-CP)', title_ar: 'شهادة SHRM للمهني المعتمد في الموارد البشرية (SHRM-CP)', provider: 'SHRM', url: 'https://www.shrm.org/credentials/certification/shrm-cp', expect: /SHRM-CP/i, level: 'intermediate', skills_en: ['HR operations', 'talent acquisition', 'employee relations', 'HR strategy'], skills_ar: ['عمليات الموارد البشرية', 'استقطاب المواهب', 'علاقات الموظفين'], target_roles: ['hr specialist', 'hr generalist', 'recruiter'] },
];

// Words an official page uses when a credential is withdrawn or replaced.
const RETIRED = /\b(has been retired|was retired|is retired|retirement date|no longer (?:available|offered)|discontinued)\b/i;

async function check(entry) {
  try {
    const res = await fetch(entry.url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; catalog-check)', accept: 'text/html' }, signal: AbortSignal.timeout(30_000) });
    const html = await res.text();
    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? html.match(/property="og:title"\s+content="([^"]*)"/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
    if (res.status !== 200) return { ok: false, why: `HTTP ${res.status}` };
    if (!entry.expect.test(title)) return { ok: false, why: `title "${title.slice(0, 120)}" doesn't name it` };
    // Only the main text, not scripts: a retirement notice elsewhere on a site is not about this credential.
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
    if (RETIRED.test(text)) return { ok: false, why: 'the page mentions retirement or withdrawal: a person must check it' };
    return { ok: true, title, final_url: res.url };
  } catch (error) {
    return { ok: false, why: `unreachable (${error.cause?.code ?? error.name})` };
  }
}

const today = new Date().toISOString().slice(0, 10);
const passed = [];
for (const entry of ENTRIES) {
  const result = await check(entry);
  console.log(`${result.ok ? 'VERIFIED' : 'LEFT OUT'}  ${entry.title_en} — ${result.ok ? result.title : result.why}`);
  if (result.ok) passed.push({ entry, result });
}
console.log(`\n${passed.length} of ${ENTRIES.length} verified on ${today}.`);
if (dry || passed.length === 0) process.exit(0);

const lit = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => `array[${(a ?? []).map(lit).join(',')}]::text[]`;
const sql = ['begin;', ...passed.map(({ entry: e, result: r }) => `
  delete from public.learning_resources where url = ${lit(e.url)};
  insert into public.learning_resources (kind, title_ar, title_en, provider, url, verified_on, notes, skills_en, skills_ar, level, duration, cost, prerequisites, target_roles, verification)
  values (${lit(e.kind)}, ${lit(e.title_ar)}, ${lit(e.title_en)}, ${lit(e.provider)}, ${lit(e.url)}, ${lit(today)}, 'Verified from the official page by scripts/verify-learning-catalog.mjs',
          ${arr(e.skills_en)}, ${arr(e.skills_ar)}, ${lit(e.level)}, ${lit(e.duration)}, ${lit(e.cost)}, ${lit(e.prerequisites)}, ${arr(e.target_roles)},
          ${lit(JSON.stringify({ status: 200, page_title: r.title, final_url: r.final_url, checked_at: new Date().toISOString(), checks: ['http_200', 'title_names_it', 'no_retirement_notice'] }))}::jsonb);`), 'commit;'].join('\n');
if (process.env.CATALOG_DATABASE_URL) {
  execFileSync('psql', [process.env.CATALOG_DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
} else {
  execFileSync(`${ROOT}scripts/local-db.sh`, ['psql', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
}
console.log(`Wrote ${passed.length} entries.`);
