/** Reads an uploaded file of job records, CSV or JSON, into rows the database can preview and import. Nothing here is saved. */

export const LISTING_SOURCE_TYPES = ['employer_provided', 'employer_career_site', 'other_authorized'] as const;
export const MAX_LISTING_ROWS = 5000;
const EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'contract', 'temporary', 'internship', 'flexible']);

// The names a source might use for each field, in English or Arabic. Anything else is reported, not guessed at.
const COLUMNS: Record<string, string[]> = {
  job_title: ['job_title', 'title', 'job_name', 'position', 'المسمى_الوظيفي', 'عنوان_الوظيفة', 'الوظيفة'],
  job_description: ['job_description', 'description', 'الوصف', 'وصف_الوظيفة'],
  requirements: ['requirements', 'qualifications', 'المتطلبات', 'المؤهلات'],
  job_url: ['job_url', 'source_url', 'url', 'link', 'الرابط', 'رابط_الوظيفة'],
  source_job_id: ['source_job_id', 'job_id', 'id', 'رقم_الوظيفة'],
  employer_name: ['employer_name', 'employer_name_raw', 'employer', 'company', 'company_name', 'الشركة', 'اسم_الشركة', 'جهة_العمل'],
  company_id: ['company_id', 'رقم_الشركة'],
  location: ['location', 'city', 'المدينة', 'الموقع'],
  employment_type: ['employment_type', 'نوع_الدوام'],
  collected_at: ['collected_at', 'scraped_at', 'posted_at', 'date', 'تاريخ_الجمع', 'تاريخ_النشر'],
};
const FIELD_BY_NAME = new Map(Object.entries(COLUMNS).flatMap(([field, names]) => names.map((name) => [name, field] as const)));
const headerKey = (header: string) => header.trim().toLowerCase().replace(/[\s-]+/g, '_');

export type ListingRow = { row: number; record: Record<string, string>; errors: string[]; warnings: string[] };
export type ParsedListings = { format: 'csv' | 'json'; rows: ListingRow[]; unknown_columns: string[]; missing_columns: string[] };
export class ListingFileError extends Error {}

/** RFC 4180: quoted fields can hold commas, line breaks and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted) throw new ListingFileError('unterminated_quote');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ''));
}

function validate(row: number, values: Record<string, string>): ListingRow {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) if (value.trim()) record[key] = value.trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!record.job_title) errors.push('missing_title');
  else if (record.job_title.length > 300) errors.push('title_too_long');
  if (!record.job_url) errors.push('missing_url');
  else if (!/^https:\/\/\S+$/i.test(record.job_url)) errors.push('url_not_https');
  if (record.collected_at && Number.isNaN(Date.parse(record.collected_at))) errors.push('invalid_date');
  if ((record.job_description?.length ?? 0) > 20000 || (record.requirements?.length ?? 0) > 20000) errors.push('text_too_long');
  if (!record.employer_name && !record.company_id) warnings.push('no_employer');
  if (record.employment_type && !EMPLOYMENT_TYPES.has(record.employment_type)) warnings.push('unknown_employment_type');
  if (!record.job_description && !record.requirements) warnings.push('no_description');
  return { row, record, errors, warnings };
}

export function parseListingFile(buffer: Buffer, fileName: string): ParsedListings {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    throw new ListingFileError('not_utf8');
  }
  const json = /\.json$/i.test(fileName);
  if (!json && !/\.csv$/i.test(fileName)) throw new ListingFileError('unsupported_format');

  const unknown = new Set<string>();
  const mapRow = (source: Record<string, unknown>) => {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(source)) {
      const field = FIELD_BY_NAME.get(headerKey(key));
      if (!field) unknown.add(key);
      else if (value !== null && value !== undefined) values[field] = String(value);
    }
    return values;
  };

  let rows: ListingRow[];
  if (json) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ListingFileError('invalid_json');
    }
    const list = Array.isArray(data) ? data : (data as { listings?: unknown })?.listings;
    if (!Array.isArray(list)) throw new ListingFileError('invalid_json');
    rows = list.map((item, index) => (item && typeof item === 'object' && !Array.isArray(item)
      ? validate(index + 1, mapRow(item as Record<string, unknown>))
      : { row: index + 1, record: {}, errors: ['not_an_object'], warnings: [] }));
  } else {
    const [header, ...lines] = parseCsv(text);
    if (!header) throw new ListingFileError('empty_file');
    // The header is row 1, so these numbers match what someone sees in a spreadsheet.
    rows = lines.map((line, index) => validate(index + 2, mapRow(Object.fromEntries(header.map((name, i) => [name, line[i] ?? ''])))));
  }
  if (rows.length === 0) throw new ListingFileError('empty_file');
  if (rows.length > MAX_LISTING_ROWS) throw new ListingFileError('too_many_rows');
  const present = new Set(rows.flatMap((r) => Object.keys(r.record)));
  return {
    format: json ? 'json' : 'csv', rows, unknown_columns: [...unknown],
    missing_columns: ['job_title', 'job_url'].filter((field) => !present.has(field)),
  };
}
