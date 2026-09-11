import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import {
  CHOICE_GROUPS_KEY,
  collectSelectedChoiceCellIds,
  isChoiceGroupTableQuestion,
  readTableChoiceGroups,
} from './choice-selection';

const groups = [
  { id: 'g1', groupKey: 'rad1', type: 'radio', label: '보유' },
  { id: 'g2', groupKey: 'cb1', type: 'checkbox', label: '구매처' },
];

const rows = [
  {
    id: 'r1',
    label: '',
    cells: [
      { id: 'a', content: 'A', type: 'choice_opt', choiceGroupId: 'g1' },
      { id: 'b', content: 'B', type: 'choice_opt', choiceGroupId: 'g1' },
      { id: 'c', content: 'C', type: 'choice_opt', choiceGroupId: 'g2' },
      { id: 'd', content: 'D', type: 'choice_opt', choiceGroupId: 'g2' },
      { id: 'amount', content: '', type: 'input' },
    ],
  },
];

const legacyRadio = {
  id: 'q-legacy',
  type: 'radio',
  title: '',
  required: false,
  order: 0,
  choiceGroups: groups,
  tableRowsData: rows,
} as unknown as Question;

const choiceGroupTable = { ...legacyRadio, id: 'q-table', type: 'table' } as unknown as Question;

describe('collectSelectedChoiceCellIds — 보기 그룹 표', () => {
  it('table 문항은 표 응답 안 예약 키에서 그룹 선택을 읽는다', () => {
    const value = { amount: '12', [CHOICE_GROUPS_KEY]: { rad1: 'a', cb1: ['c', 'd'] } };
    expect([...collectSelectedChoiceCellIds(choiceGroupTable, value)].sort()).toEqual([
      'a',
      'c',
      'd',
    ]);
  });

  it('예약 키가 없거나 표 응답이 객체가 아니면 빈 집합이다', () => {
    expect(collectSelectedChoiceCellIds(choiceGroupTable, { amount: '12' }).size).toBe(0);
    expect(collectSelectedChoiceCellIds(choiceGroupTable, undefined).size).toBe(0);
    expect(collectSelectedChoiceCellIds(choiceGroupTable, 'a').size).toBe(0);
  });

  it('셀 값 키는 선택으로 세지 않는다 — 셀 id 가 보기 id 와 겹쳐도 예약 키만 본다', () => {
    const value = { a: '셀 값', [CHOICE_GROUPS_KEY]: { rad1: 'b' } };
    expect([...collectSelectedChoiceCellIds(choiceGroupTable, value)]).toEqual(['b']);
  });

  it('레거시 radio/checkbox 의 세 모양은 그대로 읽는다', () => {
    expect([...collectSelectedChoiceCellIds(legacyRadio, { rad1: 'a', cb1: ['c'] })].sort()).toEqual([
      'a',
      'c',
    ]);
    const ungrouped = { ...legacyRadio, choiceGroups: undefined } as unknown as Question;
    expect([...collectSelectedChoiceCellIds(ungrouped, 'b')]).toEqual(['b']);
    expect([...collectSelectedChoiceCellIds(ungrouped, ['c', 'd'])]).toEqual(['c', 'd']);
    expect([...collectSelectedChoiceCellIds(ungrouped, { selectedValue: 'a' })]).toEqual(['a']);
  });
});

describe('readTableChoiceGroups', () => {
  it('예약 키 아래 그룹 맵을 돌려주고, 없으면 빈 맵이다', () => {
    expect(readTableChoiceGroups({ [CHOICE_GROUPS_KEY]: { rad1: 'a' } })).toEqual({ rad1: 'a' });
    expect(readTableChoiceGroups({ amount: '1' })).toEqual({});
    expect(readTableChoiceGroups(null)).toEqual({});
    expect(readTableChoiceGroups({ [CHOICE_GROUPS_KEY]: 'a' })).toEqual({});
  });
});

describe('isChoiceGroupTableQuestion', () => {
  it('유형이 table 이고 radio/checkbox 그룹이 있을 때만 참이다', () => {
    expect(isChoiceGroupTableQuestion(choiceGroupTable)).toBe(true);
    expect(isChoiceGroupTableQuestion(legacyRadio)).toBe(false);
    expect(
      isChoiceGroupTableQuestion({ ...choiceGroupTable, choiceGroups: [] } as unknown as Question),
    ).toBe(false);
  });
});
