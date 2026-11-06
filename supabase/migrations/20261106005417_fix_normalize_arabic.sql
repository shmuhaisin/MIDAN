-- Correct letter mapping, written as code points so it can't be misread: each hamza form and ta marbuta to its plain letter.
create or replace function public.normalize_arabic(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select trim(regexp_replace(
    regexp_replace(
      translate(
        regexp_replace(lower(coalesce(p, '')), '[ً-ٰٟـ]', '', 'g'),
        E'أإآٱىؤئة', E'اااايويه'
      ),
      '(^|\s)ال(?=\S{2,})', '\1', 'g'
    ),
    '\s+', ' ', 'g'
  ))
$$;
update public.reference_skills set name_ar = name_ar;
