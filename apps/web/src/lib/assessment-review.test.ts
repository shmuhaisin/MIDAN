import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextId, uncoveredItems } from './assessment-review.ts';

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
