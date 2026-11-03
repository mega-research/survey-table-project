import { describe, expect, it } from 'vitest';

import { buildProfileAnswerModel } from '@/lib/operations/profile-answer-sources';
import { answerColumnKey } from '@/lib/operations/profile-columns-format';
import { normalizeQuestions } from '@/lib/question';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';
import type { Question } from '@/types/survey';

const opt = (id: string, value: string, label: string) => ({ id, value, label });
const base = (id: string, type: string, code: string, order: number, extra: object = {}) =>
  ({ id, type, title: `${code} 제목`, questionCode: code, isCustomSpssVarName: true, order, required: true, ...extra }) as unknown;

const questions = hydrateQuestionsForSpss(
  normalizeQuestions([
    base('q-text', 'text', 'T1', 1),
    base('q-radio', 'radio', 'R1', 2, { options: [opt('o1', '1', '① 남성'), opt('o2', '2', '② 여성')] }),
    base('q-check', 'checkbox', 'C1', 3, { options: [opt('c1', '1', '① AI'), opt('c2', '2', '② 반도체')] }),
    base('q-select', 'select', 'S1', 4, { options: [opt('s1', '1', '서울'), opt('s2', '2', '부산')] }),
    base('q-table', 'table', 'TB', 5, {
      tableColumns: [
        { id: 'k1', label: '', width: 100, columnCode: 'c01' },
        { id: 'k2', label: '', width: 100, columnCode: 'c02' },
        { id: 'k3', label: '', width: 100, columnCode: 'c03' },
        { id: 'k4', label: '', width: 100, columnCode: 'c04' },
      ],
      tableRowsData: [{
        id: 'row1', label: '', rowCode: 'r01',
        cells: [
          { id: 'lbl', type: 'text', content: '성별' },
          { id: 'cell-radio', type: 'radio', content: '', radioOptions: [opt('ro1', '1', '남'), opt('ro2', '2', '여')] },
          { id: 'cell-check', type: 'checkbox', content: '', checkboxOptions: [opt('co1', '1', '가'), opt('co2', '2', '나')] },
          { id: 'cell-input', type: 'input', content: '' },
        ],
      }],
    }),
  ] as never) as Question[],
);

/** 보기를 표로 그린 단일 선택 — 보기 그룹 수만 다르게 */
function choiceTable(id: string, code: string, groupKeys: string[]): unknown {
  const groups = groupKeys.map((k, i) => ({ id: `${id}-g${i}`, type: 'radio', label: k, groupKey: k }));
  return base(id, 'radio', code, 9, {
    tableColumns: [{ id: `${id}-k1`, label: '', width: 100 }, { id: `${id}-k2`, label: '', width: 100 }],
    tableRowsData: groups.map((g, i) => ({
      id: `${id}-row${i}`, label: '', cells: [1, 2].map((n) => ({
        id: `${id}-r${i}-o${n}`, type: 'choice_opt', content: `보기${n}`, choiceLabel: `보기${n}`, choiceGroupId: g.id, spssNumericCode: n,
      })),
    })),
    choiceGroups: groups,
  });
}

describe('buildProfileAnswerModel — 보기 그룹', () => {
  const prepared = hydrateQuestionsForSpss(
    normalizeQuestions([choiceTable('q-one', 'G1', ['default']), choiceTable('q-two', 'G2', ['rad01', 'rad02'])] as never) as Question[],
  );
  const { sources, choices } = buildProfileAnswerModel(prepared, new Set());

  it('그룹이 default 하나면 문항 열 하나(보기 = 표의 보기 칸), 여럿이면 후보에서 뺀다', () => {
    expect(sources.map((s) => s.varName)).toEqual(['G1']);
    expect(choices.get(answerColumnKey('q-one'))?.map((c) => [c.value, c.label])).toEqual([
      ['q-one-r0-o1', '보기1'],
      ['q-one-r0-o2', '보기2'],
    ]);
  });
});

describe('buildProfileAnswerModel — 응답값 열 후보', () => {
  const { sources, choices } = buildProfileAnswerModel(questions, new Set());
  const byKey = new Map(sources.map((s) => [s.key, s]));

  it('글자 문항·입력 칸에 더해 보기 문항과 표의 선택 칸이 후보에 오른다 — 화면 순서', () => {
    expect(sources.map((s) => s.varName)).toEqual(['T1', 'R1', 'C1', 'S1', 'TB_r01_c02', 'TB_r01_c03', 'TB_r01_c04']);
  });

  it('복수 선택은 보기마다가 아니라 문항(칸) 하나에 열 하나 — 변수명에 보기 접미가 없다', () => {
    expect(sources.filter((s) => s.key.startsWith(answerColumnKey('q-check')))).toHaveLength(1);
    expect(byKey.get(answerColumnKey('q-table', 'cell-check'))?.varName).toBe('TB_r01_c03');
  });

  it('보기 열에는 보기 목록이, 글자 열에는 없다', () => {
    expect(choices.get(answerColumnKey('q-radio'))).toEqual([
      { id: 'o1', value: '1', label: '① 남성' },
      { id: 'o2', value: '2', label: '② 여성' },
    ]);
    expect(choices.get(answerColumnKey('q-table', 'cell-radio'))?.map((c) => c.label)).toEqual(['남', '여']);
    expect(choices.has(answerColumnKey('q-text'))).toBe(false);
    expect(choices.has(answerColumnKey('q-table', 'cell-input'))).toBe(false);
  });

  it('표 선택 칸 이름은 같은 행 앞 글자 칸이다', () => {
    expect(byKey.get(answerColumnKey('q-table', 'cell-radio'))?.cellLabel).toBe('성별');
  });
});
