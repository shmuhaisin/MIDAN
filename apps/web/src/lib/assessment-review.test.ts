import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedFields, compareTasks, nextId, uncoveredItems, weakensCoverage, type Change, type ContentTask } from './assessment-review.ts';

const text = (ar: string | null, en: string | null) => en ?? ar ?? '';
const requirement = (id: string, requirement_type: string, is_mandatory = true) => ({ id, requirement_type, is_mandatory, description_ar: null, description_en: `Do ${id}` });
const skill = (id: string, is_required: boolean) => ({ is_required, reference_skills: { id, name_ar: `مهارة ${id}` } });

test('lists mandatory responsibilities and required workbook skills that no task measures', () => {
  const tasks = [{ reference_skill_ids: ['k1'], task_requirement_mappings: [{ requirement_id: 'r1' }] }];
  const requirements = [requirement('r1', 'responsibility'), requirement('r2', 'daily_task'), requirement('r3', 'responsibility', false), requirement('r4', 'education')];
  assert.deepEqual(uncoveredItems(tasks, requirements, [skill('k1', true), skill('k2', true), skill('k3', false)], text), ['Do r2', 'مهارة k2']);
});

test('reports nothing once everything is measured', () => {
  const tasks = [{ reference_skill_ids: ['k1'], task_requirement_mappings: [{ requirement_id: 'r1' }] }];
  assert.deepEqual(uncoveredItems(tasks, [requirement('r1', 'responsibility')], [skill('k1', true)], text), []);
});

test('a new id never repeats one still in use, even after a removal', () => {
  assert.equal(nextId(['q1', 'q2'], (n) => `q${n}`), 'q3');
  assert.equal(nextId(['q1', 'q3'], (n) => `q${n}`), 'q4');
});

const change = (action: Change['action'], entity: string, old: Record<string, unknown> | null, next: Record<string, unknown> | null): Change => ({
  id: 1, action, entity, entity_id: 'x', actor_name: 'Recruiter', created_at: '2026-11-07T10:00:00Z', needs_review: true, details: { old, new: next },
});
const task = (id: string, extra: Partial<ContentTask> = {}): ContentTask => ({
  id, position: 1, task_type: 'written_case_study', title_ar: 'م', title_en: `Task ${id}`, instructions_ar: 'ت', instructions_en: 'Do it', weight: 1, config: {},
  reference_skill_ids: [], requirement_ids: [], criteria: [], ...extra,
});

test('a change lists only the fields it touched, before and after', () => {
  const fields = changedFields(change('update', 'assessment_tasks', { id: 't', title_en: 'Old', weight: 1, updated_at: 'a' }, { id: 't', title_en: 'New', weight: 1, updated_at: 'b' }));
  assert.deepEqual(fields, [{ field: 'title_en', before: 'Old', after: 'New' }]);
  assert.deepEqual(changedFields(change('create', 'rubric_criteria', null, { id: 'c', code: 'C1' })), [{ field: 'code', before: null, after: 'C1' }]);
});

test('flags changes that remove or unlink what the assessment measures', () => {
  assert.equal(weakensCoverage(change('delete', 'assessment_tasks', { reference_skill_ids: ['k1'] }, null)), true);
  assert.equal(weakensCoverage(change('delete', 'assessment_tasks', { reference_skill_ids: [], rubric_criteria: [{ requirement_id: 'r1' }] }, null)), true);
  assert.equal(weakensCoverage(change('delete', 'task_requirement_mappings', { requirement_id: 'r1' }, null)), true);
  assert.equal(weakensCoverage(change('update', 'assessment_tasks', { reference_skill_ids: ['k1', 'k2'] }, { reference_skill_ids: ['k1'] })), true);
  assert.equal(weakensCoverage(change('update', 'rubric_criteria', { requirement_id: 'r1' }, { requirement_id: null })), true);
});

test("doesn't flag changes that keep or add coverage", () => {
  assert.equal(weakensCoverage(change('update', 'assessment_tasks', { title_en: 'a', reference_skill_ids: ['k1'] }, { title_en: 'b', reference_skill_ids: ['k1'] })), false);
  assert.equal(weakensCoverage(change('update', 'assessment_tasks', { reference_skill_ids: [] }, { reference_skill_ids: ['k1'] })), false);
  assert.equal(weakensCoverage(change('create', 'assessment_tasks', null, { reference_skill_ids: [] })), false);
  assert.equal(weakensCoverage(change('delete', 'assessment_tasks', { reference_skill_ids: [], rubric_criteria: [] }, null)), false);
});

test("shows MIDAN's original beside the draft: unchanged, changed, added and removed tasks", () => {
  const original = { settings: {}, tasks: [task('a'), task('b'), task('c')] };
  const current = { settings: {}, tasks: [{ ...task('a'), position: 2 }, task('b', { title_en: 'Edited' }), task('d')] };
  assert.deepEqual(compareTasks(original, current).map((r) => [r.status, (r.current ?? r.original)?.id]), [
    ['unchanged', 'a'], ['changed', 'b'], ['added', 'd'], ['removed', 'c'],
  ]);
  assert.deepEqual(compareTasks(null, current).map((r) => r.status), ['added', 'added', 'added']);
});
