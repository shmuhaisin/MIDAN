import { ListingFileError, MAX_LISTING_ROWS, parseCsv, parseListingFile } from './listing-file';

const csv = (text: string) => parseListingFile(Buffer.from(text), 'jobs.csv');

describe('reading uploaded job records', () => {
  it('reads CSV with quoted commas, line breaks and doubled quotes', () => {
    expect(parseCsv('a,b\r\n"one, two","line\nbreak"\n"say ""hi""",x\n')).toEqual([['a', 'b'], ['one, two', 'line\nbreak'], ['say "hi"', 'x']]);
  });

  it('refuses an unterminated quote instead of swallowing the rest of the file', () => {
    expect(() => parseCsv('a\n"open')).toThrow(ListingFileError);
  });

  it('reads Arabic headers and text, past a byte-order mark, numbering rows as a spreadsheet does', () => {
    const parsed = csv('﻿المسمى الوظيفي,الرابط,الشركة,الوصف\nمحلل بيانات,https://example.com/1,جهة وهمية,"يحلل، ويقدم التقارير"\n');
    expect(parsed.format).toBe('csv');
    expect(parsed.rows).toEqual([{
      row: 2,
      record: { job_title: 'محلل بيانات', job_url: 'https://example.com/1', employer_name: 'جهة وهمية', job_description: 'يحلل، ويقدم التقارير' },
      errors: [], warnings: [],
    }]);
  });

  it('reads JSON as a list, or under "listings", and never guesses at a value', () => {
    const list = [{ title: 'Analyst', url: 'https://example.com/a', company: 'Fictional', salary: '1000' }];
    for (const body of [list, { listings: list }]) {
      const parsed = parseListingFile(Buffer.from(JSON.stringify(body)), 'jobs.JSON');
      expect(parsed.format).toBe('json');
      expect(parsed.rows[0].record).toEqual({ job_title: 'Analyst', job_url: 'https://example.com/a', employer_name: 'Fictional' });
      expect(parsed.unknown_columns).toEqual(['salary']);
    }
    expect(parseListingFile(Buffer.from('[1]'), 'jobs.json').rows[0].errors).toEqual(['not_an_object']);
  });

  it.each([
    ['missing_title', 'title,url\n,https://example.com/1\n'],
    ['missing_url', 'title,url\nAnalyst,\n'],
    ['url_not_https', 'title,url\nAnalyst,http://example.com/1\n'],
    ['url_not_https', 'title,url\nAnalyst,javascript:alert(1)\n'],
    ['invalid_date', 'title,url,date\nAnalyst,https://example.com/1,not a date\n'],
  ])('reports %s on the row, without dropping the others', (code, text) => {
    const parsed = csv(`${text}Good,https://example.com/2\n`);
    expect(parsed.rows[0].errors).toContain(code);
    expect(parsed.rows[1].errors).toEqual([]);
  });

  it('warns about what a person should look at, without refusing the row', () => {
    const [row] = csv('title,url,employment_type\nAnalyst,https://example.com/1,sometimes\n').rows;
    expect(row.errors).toEqual([]);
    expect(row.warnings).toEqual(expect.arrayContaining(['no_employer', 'unknown_employment_type', 'no_description']));
  });

  it('says when a required column is missing altogether', () => {
    expect(csv('name\nAnalyst\n').missing_columns).toEqual(['job_title', 'job_url']);
  });

  it.each([
    ['not_utf8', Buffer.from([0xff, 0xfe, 0x00]), 'jobs.csv'],
    ['unsupported_format', Buffer.from('a'), 'jobs.xlsx'],
    ['invalid_json', Buffer.from('{nope'), 'jobs.json'],
    ['invalid_json', Buffer.from('{"a":1}'), 'jobs.json'],
    ['empty_file', Buffer.from('title,url\n'), 'jobs.csv'],
    ['empty_file', Buffer.from(''), 'jobs.csv'],
    ['too_many_rows', Buffer.from(`title\n${'x\n'.repeat(MAX_LISTING_ROWS + 1)}`), 'jobs.csv'],
  ])('refuses a file: %s', (code, buffer, name) => {
    expect(() => parseListingFile(buffer, name)).toThrow(code);
  });
});
