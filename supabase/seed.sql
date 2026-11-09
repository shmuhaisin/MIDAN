-- Fictional demo data only. These organizations and jobs are not real opportunities.
-- Skills are unreviewed drafts: Midan's own wording, not taken from any official classification.

insert into public.skill_categories (slug, name_ar, name_en) values
  ('analytical', 'المهارات التحليلية', 'Analytical skills'),
  ('communication', 'مهارات التواصل', 'Communication skills'),
  ('technical', 'المهارات التقنية', 'Technical skills');

insert into public.skills (category_id, slug, name_ar, name_en, source, review_status)
select c.id, s.slug, s.name_ar, s.name_en, 'Midan draft, not yet reviewed by a domain expert', 'draft'
from (values
  ('analytical', 'data-analysis', 'تحليل البيانات', 'Data analysis'),
  ('analytical', 'critical-thinking', 'التفكير النقدي', 'Critical thinking'),
  ('analytical', 'problem-solving', 'حل المشكلات', 'Problem solving'),
  ('communication', 'written-communication', 'التواصل الكتابي', 'Written communication'),
  ('technical', 'sql', 'لغة SQL', 'SQL'),
  ('technical', 'spreadsheets', 'الجداول الإلكترونية', 'Spreadsheets')
) as s(category, slug, name_ar, name_en)
join public.skill_categories c on c.slug = s.category;

-- The general L0 to L4 scale, as a starting point until each skill gets its own descriptors.
insert into public.skill_levels (skill_id, level, descriptor_ar, descriptor_en)
select s.id, l.level, l.ar, l.en
from public.skills s cross join (values
  (0, 'ما قُدّم لا يكفي للحكم على المهارة.', 'The submission is not enough to judge the skill.'),
  (1, 'يطبق الأساسيات في المواقف البسيطة وبتوجيه.', 'Applies the fundamentals in simple situations, with guidance.'),
  (2, 'ينجز معظم المطلوب مع نقص في العمق أو التعليل.', 'Completes most of what is needed, lacking some depth or reasoning.'),
  (3, 'ينجز العمل باستقلالية ويدعم قراراته بالدليل.', 'Works independently and supports decisions with evidence.'),
  (4, 'يتعامل مع التعقيد ويتوقع الآثار ويرفع جودة الحل.', 'Handles complexity, anticipates consequences and raises the quality of the solution.')
) as l(level, ar, en);

-- Fictional demo organizations count as reviewed (20261111090000_organization_verification).
insert into public.organizations (slug, name_ar, name_en, description, is_demo, verification_status) values
  ('demo-najd-analytics', 'نجد للتحليلات (منشأة تجريبية)', 'Najd Analytics (demo organization)', 'Fictional organization for demonstration.', true, 'approved'),
  ('demo-sahel-finance', 'الساحل المالية (منشأة تجريبية)', 'Sahel Finance (demo organization)', 'Fictional organization for demonstration.', true, 'approved');

insert into public.organization_branding (org_id, primary_color, accent_color, industry)
select id, '#1F7A4D', '#D4AF37', case slug when 'demo-sahel-finance' then 'finance' else 'technology' end
from public.organizations where is_demo;

insert into public.jobs (org_id, slug, title_ar, title_en, description_ar, description_en, location, status, is_demo, published_at)
select o.id, j.slug, j.title_ar, j.title_en, j.d_ar, j.d_en, j.location, 'published', true, now()
from (values
  ('demo-najd-analytics', 'data-analyst', 'محلل بيانات (وظيفة تجريبية)', 'Data Analyst (demo job)',
    'وظيفة خيالية لأغراض العرض فقط.', 'A fictional job for demonstration only.', 'Riyadh'),
  ('demo-sahel-finance', 'finance-specialist', 'أخصائي مالي (وظيفة تجريبية)', 'Finance Specialist (demo job)',
    'وظيفة خيالية لأغراض العرض فقط.', 'A fictional job for demonstration only.', 'Jeddah')
) as j(org, slug, title_ar, title_en, d_ar, d_en, location)
join public.organizations o on o.slug = j.org;

insert into public.job_skills (job_id, org_id, skill_id, required_level)
select j.id, j.org_id, s.id, 3
from public.jobs j join public.skills s on
  (j.slug = 'data-analyst' and s.slug in ('data-analysis', 'sql', 'written-communication'))
  or (j.slug = 'finance-specialist' and s.slug in ('spreadsheets', 'critical-thinking', 'written-communication'));
