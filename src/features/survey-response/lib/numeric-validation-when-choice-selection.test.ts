import { describe, expect, it } from 'vitest';

import type { Question, SumConstraint } from '@/types/survey';

import { collectNumericIssues, collectTableSoftWarnings } from './numeric-validation';

/**
 * 제약 적용 조건(when)의 보기 선택 문맥 (2026-11-06 리뷰 지적).
 * 컨트롤러가 보기 그룹 선택으로 열리는 칸이면(칸 게이팅 또는 드롭다운 보기 표시 조건), when 판정에도 실제
 * 선택 집합이 있어야 한다 — 없으면 정상 선택값을 잔존값으로 보고 제약을 건너뛴다.
 */
const base = {
  id: 't',
  type: 'table',
  title: '',
  required: false,
  order: 0,
  choiceGroups: [{ id: 'g', groupKey: 'g', type: 'radio', label: 'G' }],
  tableColumns: [{ id: 'c1', label: '' }, { id: 'c2', label: '' }, { id: 'c3', label: '' }],
};
const need = (severity?: 'warn'): SumConstraint => ({
  id: 'need-a',
  aggregate: 'count',
  cellIds: ['a'],
  operator: 'gte',
  target: 1,
  when: { kind: 'filled', controllerCellId: 's' },
  errorMessage: 'a 를 적어 주세요',
  ...(severity ? { severity } : {}),
});
const optionGated = (sumConstraints: SumConstraint[]) =>
  ({
    ...base,
    sumConstraints,
    tableRowsData: [{
      id: 'r', label: '', cells: [
        { id: 'opt', type: 'choice_opt', content: '예', choiceGroupId: 'g' },
        { id: 's', type: 'select', content: '', selectOptions: [{ id: 's1', label: '1', value: '1', enabledWhen: { kind: 'choice-selected', controllerCellId: 'opt' } }] },
        { id: 'a', type: 'input', content: '' },
      ],
    }],
  }) as unknown as Question;
const cellGated = (sumConstraints: SumConstraint[]) =>
  ({
    ...base,
    sumConstraints,
    tableRowsData: [{
      id: 'r', label: '', cells: [
        { id: 'opt', type: 'choice_opt', content: '예', choiceGroupId: 'g' },
        { id: 's', type: 'input', content: '', enabledWhen: { kind: 'choice-selected', controllerCellId: 'opt' } },
        { id: 'a', type: 'input', content: '' },
      ],
    }],
  }) as unknown as Question;
const value = { __choiceGroups: { g: 'opt' }, s: '1' };

describe('제약 when 의 보기 선택 문맥', () => {
  it.each([
    ['드롭다운 보기 표시 조건', optionGated],
    ['칸 게이팅', cellGated],
  ])('보기 선택으로 열린 컨트롤러(%s)를 when 이 보면 차단 제약이 그대로 걸린다', (_label, build) => {
    const issues = collectNumericIssues(build([need()]), value, undefined).filter((i) => i.message.includes('a 를'));
    expect(issues).toHaveLength(1);
  });

  it('경고 제약도 같다', () => {
    expect(collectTableSoftWarnings(optionGated([need('warn')]), value, undefined)).toHaveLength(1);
  });
});
