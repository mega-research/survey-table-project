import { describe, expect, it } from 'vitest';

import { buildDataRow, generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import type { QuestionVariant } from '@/lib/question';
import type { Question, QuestionOption, SurveySubmission, TableCell } from '@/types/survey';

import {
  formatScaleMean,
  formatScaleMean100,
  listScaleMeanCandidates,
  overallRowLabel,
  resolveScaleMeanSelection,
  summarizeScaleMeans,
} from './scale-mean-format';

const SEVEN = ['매우 불만족', '불만족', '약간 불만족', '보통', '약간 만족', '만족', '매우 만족'];

function radioQ(id: string, code: string, extra: Partial<Question> = {}): Question {
  const options: QuestionOption[] = SEVEN.map((label, i) => ({
    id: `${id}-o${i + 1}`,
    label,
    value: String(i + 1),
  }));
  return {
    id,
    type: 'radio',
    title: `${code}. 만족하십니까?`,
    order: 1,
    required: true,
    questionCode: code,
    options,
    scaleMeanEnabled: true,
    ...extra,
  } as Question;
}

/** 보기를 표 칸(choice_opt)에서 가져오는 radio — 균형성장 Q1~Q5 모양. 응답값은 칸 id 다. */
function choiceTableQ(id: string, code: string): Question {
  const cells: TableCell[] = SEVEN.map((label, i) => ({
    id: `${id}-c${i + 1}`,
    type: 'choice_opt',
    content: `${i + 1}\n${label}`,
  }));
  return {
    id,
    type: 'radio',
    title: `${code}. 표 보기`,
    order: 1,
    required: true,
    questionCode: code,
    tableColumns: cells.map((_, i) => ({ id: `${id}-col${i + 1}`, label: '' })),
    tableRowsData: [{ id: `${id}-r1`, label: '', cells }],
    scaleMeanEnabled: true,
  } as unknown as Question;
}

/** 행마다 한 칸 한 보기 radio 칸을 radioGroupName 으로 묶은 행렬 척도 — 마지막 열은 「모름」. */
function matrixQ(id: string, code: string, rowLabels: string[]): Question {
  const columnLabels = [...SEVEN.map((_, i) => String(i + 1)), '모름'];
  return {
    id,
    type: 'table',
    title: `${code}. 요소별 만족도`,
    order: 1,
    required: true,
    questionCode: code,
    tableColumns: [
      { id: `${id}-h`, label: '항목' },
      ...columnLabels.map((label, i) => ({ id: `${id}-col${i + 1}`, label })),
    ],
    tableRowsData: rowLabels.map((label, r) => ({
      id: `${id}-r${r + 1}`,
      label,
      rowCode: `r${r + 1}`,
      cells: [
        { id: `${id}-r${r + 1}-h`, type: 'text', content: label },
        ...columnLabels.map((colLabel, c) => ({
          id: `${id}-r${r + 1}-c${c + 1}`,
          type: 'radio',
          content: '',
          radioGroupName: `${id}-g${r + 1}`,
          radioOptions: [{ id: `${id}-r${r + 1}-c${c + 1}-o`, label: colLabel, value: colLabel }],
          ...(colLabel === '모름' ? { excludeFromMean: true } : {}),
        })),
      ],
    })),
    scaleMeanEnabled: true,
  } as unknown as Question;
}

function sub(
  questionResponses: Record<string, unknown>,
): Pick<SurveySubmission, 'questionResponses'> {
  return { questionResponses };
}

describe('척도 평균 — 단일 선택 문항', () => {
  it('켠 문항만 줄이 되고, 점수는 보기 값 코드다', () => {
    const q1 = radioQ('q1', 'Q1');
    const q2 = radioQ('q2', 'Q2', { scaleMeanEnabled: false });
    const result = summarizeScaleMeans(
      [q1, q2],
      [sub({ q1: 'q1-o5', q2: 'q2-o1' }), sub({ q1: 'q1-o7' }), sub({ q1: 'q1-o3' })],
    );

    expect(result.rows.map((r) => r.varName)).toEqual(['Q1']);
    expect(result.rows[0]).toMatchObject({ mean: 5, count: 3, scaleMin: 1, scaleMax: 7 });
  });

  it('줄 이름은 문항 제목(줄바꿈은 공백으로)이다', () => {
    const q1 = radioQ('q1', 'Q1', { title: '1. 귀하는\n만족하십니까?' });
    const result = summarizeScaleMeans([q1], [sub({ q1: 'q1-o1' })]);
    expect(result.rows[0]?.label).toBe('1. 귀하는 만족하십니까?');
  });

  it('보기를 표 칸에서 가져오는 문항은 칸 순서가 점수다 — 내보내기 값과 같다', () => {
    const q = choiceTableQ('q1', 'Q1');
    const answers = [sub({ q1: 'q1-c2' }), sub({ q1: 'q1-c6' })];
    const result = summarizeScaleMeans([q], answers);

    const columns = generateSPSSColumns([q] as unknown as QuestionVariant[]);
    const questionMap = new Map([[q.id, q as unknown as QuestionVariant]]);
    const exported = answers.map(
      (a) => buildDataRow(columns, questionMap, a as SurveySubmission)[0],
    );

    expect(exported).toEqual([2, 6]);
    expect(result.rows[0]).toMatchObject({ mean: 4, count: 2 });
  });

  it('미응답·구조에 없는 값은 세지 않는다', () => {
    const q = radioQ('q1', 'Q1');
    const result = summarizeScaleMeans(
      [q],
      [sub({ q1: 'q1-o4' }), sub({}), sub({ q1: 'gone-option' })],
    );
    expect(result.rows[0]).toMatchObject({ mean: 4, count: 1 });
  });

  it('「평균에서 제외」 보기를 고른 응답은 평균과 응답수에서 빠지고 척도 범위에서도 빠진다', () => {
    const q = radioQ('q1', 'Q1');
    q.options = [
      ...(q.options ?? []),
      { id: 'q1-o8', label: '모름', value: '8', excludeFromMean: true },
    ];
    const result = summarizeScaleMeans([q], [sub({ q1: 'q1-o8' }), sub({ q1: 'q1-o2' })]);
    expect(result.rows[0]).toMatchObject({ mean: 2, count: 1, scaleMin: 1, scaleMax: 7 });
  });

  it('보기 칸의 「평균에서 제외」도 같다', () => {
    const q = choiceTableQ('q1', 'Q1');
    const cells = q.tableRowsData![0]!.cells;
    cells.push({ id: 'q1-c8', type: 'choice_opt', content: '모름', excludeFromMean: true });
    q.tableColumns!.push({ id: 'q1-col8', label: '' });
    const result = summarizeScaleMeans([q], [sub({ q1: 'q1-c8' }), sub({ q1: 'q1-c7' })]);
    expect(result.rows[0]).toMatchObject({ mean: 7, count: 1, scaleMax: 7 });
  });

  it('응답이 하나도 없으면 평균은 비고 응답수는 0', () => {
    const result = summarizeScaleMeans([radioQ('q1', 'Q1')], []);
    expect(result.rows[0]).toMatchObject({ mean: null, count: 0 });
  });
});

describe('척도 평균 — 100점 환산', () => {
  it('7점 척도는 1점이 0, 4점이 50, 7점이 100 이다', () => {
    const q = radioQ('q1', 'Q1');
    const at = (option: string) =>
      summarizeScaleMeans([q], [sub({ q1: option })]).rows[0]?.mean100;
    expect(at('q1-o1')).toBe(0);
    expect(at('q1-o4')).toBe(50);
    expect(at('q1-o7')).toBe(100);
  });

  it('줄 평균을 척도 범위로 환산한다 — 「평균에서 제외」 보기는 범위에 들지 않는다', () => {
    const q = radioQ('q1', 'Q1');
    q.options = [
      ...(q.options ?? []),
      { id: 'q1-o8', label: '모름', value: '8', excludeFromMean: true },
    ];
    const result = summarizeScaleMeans(
      [q],
      [sub({ q1: 'q1-o5' }), sub({ q1: 'q1-o6' }), sub({ q1: 'q1-o8' })],
    );
    // 평균 5.5 → (5.5 - 1) / 6 × 100 = 75
    expect(result.rows[0]).toMatchObject({ mean: 5.5, mean100: 75, scaleMax: 7 });
  });

  it('5점 척도는 제 범위로 환산한다', () => {
    const q = radioQ('q1', 'Q1');
    q.options = q.options!.slice(0, 5);
    const result = summarizeScaleMeans([q], [sub({ q1: 'q1-o2' })]);
    expect(result.rows[0]?.mean100).toBe(25);
  });

  it('응답이 없거나 척도 범위가 한 점이면 비운다', () => {
    expect(summarizeScaleMeans([radioQ('q1', 'Q1')], []).rows[0]?.mean100).toBeNull();
    const single = radioQ('q1', 'Q1');
    single.options = single.options!.slice(0, 1);
    expect(
      summarizeScaleMeans([single], [sub({ q1: 'q1-o1' })]).rows[0]?.mean100,
    ).toBeNull();
  });
});

describe('척도 평균 — 표 행렬 척도', () => {
  it('행마다 한 줄이고 「모름」 칸은 빠진다', () => {
    const q = matrixQ('m', 'Q7', ['시설', '프로그램']);
    const result = summarizeScaleMeans(
      [q],
      [
        sub({ m: { 'm-r1-c6': 'm-r1-c6-o', 'm-r2-c8': 'm-r2-c8-o' } }),
        sub({ m: { 'm-r1-c4': 'm-r1-c4-o', 'm-r2-c3': 'm-r2-c3-o' } }),
      ],
    );

    expect(result.rows.map((r) => [r.varName, r.label])).toEqual([
      ['Q7_r1', '시설'],
      ['Q7_r2', '프로그램'],
    ]);
    expect(result.rows[0]).toMatchObject({ mean: 5, count: 2, scaleMin: 1, scaleMax: 7 });
    expect(result.rows[1]).toMatchObject({ mean: 3, count: 1 });
  });
});

describe('척도 평균 — 종합 평균', () => {
  it('응답자별 평균의 평균이다 — 일부 줄만 답한 응답자도 자기 평균으로 들어간다', () => {
    const q1 = radioQ('q1', 'Q1');
    const q2 = radioQ('q2', 'Q2');
    const result = summarizeScaleMeans(
      [q1, q2],
      [
        // 응답자 A: (2 + 4) / 2 = 3
        sub({ q1: 'q1-o2', q2: 'q2-o4' }),
        // 응답자 B: Q1 만 7
        sub({ q1: 'q1-o7' }),
        // 응답자 C: 점수 없음 — 응답수에서 빠진다
        sub({}),
      ],
    );

    // 100점 환산: A (16.67 + 50) / 2 = 33.33…, B 100 → (33.33… + 100) / 2 = 66.66…
    expect(result.overall).toMatchObject({ kind: 'mean', mean: 5, count: 2 });
    expect(result.overall.kind === 'mean' && result.overall.mean100).toBeCloseTo(200 / 3, 10);
  });

  it('척도 범위가 다른 줄이 섞이면 종합 평균을 내지 않는다', () => {
    const seven = radioQ('q1', 'Q1');
    const five = radioQ('q2', 'Q2');
    five.options = five.options!.slice(0, 5);
    const result = summarizeScaleMeans([seven, five], [sub({ q1: 'q1-o7', q2: 'q2-o5' })]);
    expect(result.overall).toEqual({ kind: 'mixed-scale', mean100: 100, count: 1 });
    expect(result.rows.map((r) => r.mean)).toEqual([7, 5]);
  });

  it('척도가 섞여도 100점 환산 종합은 줄마다 제 범위로 환산한 뒤 응답자별 평균의 평균이다', () => {
    const seven = radioQ('q1', 'Q1');
    const five = radioQ('q2', 'Q2');
    five.options = five.options!.slice(0, 5);
    // 7점 4 → 50, 5점 2 → 25 → 응답자 평균 37.5
    const result = summarizeScaleMeans([seven, five], [sub({ q1: 'q1-o4', q2: 'q2-o2' })]);
    expect(result.overall).toEqual({ kind: 'mixed-scale', mean100: 37.5, count: 1 });
  });

  it('같은 척도면 100점 환산 종합은 원점수 종합을 환산한 값과 같다', () => {
    const result = summarizeScaleMeans(
      [radioQ('q1', 'Q1'), radioQ('q2', 'Q2')],
      [sub({ q1: 'q1-o2', q2: 'q2-o5' }), sub({ q1: 'q1-o6' }), sub({ q2: 'q2-o3' })],
    );
    if (result.overall.kind !== 'mean') throw new Error('종합 평균이 나와야 한다');
    expect(result.overall.mean100).toBeCloseTo(((result.overall.mean! - 1) / 6) * 100, 10);
  });

  it('켠 문항이 없으면 줄도 종합도 없다', () => {
    const result = summarizeScaleMeans(
      [radioQ('q1', 'Q1', { scaleMeanEnabled: false })],
      [sub({ q1: 'q1-o1' })],
    );
    expect(result.rows).toEqual([]);
    expect(result.overall).toEqual({ kind: 'empty' });
  });
});

describe('척도 평균 — 표시', () => {
  it('평균은 소수 둘째 자리, 없으면 대시', () => {
    expect(formatScaleMean(5.125)).toBe('5.13');
    expect(formatScaleMean(4)).toBe('4.00');
    expect(formatScaleMean(null)).toBe('—');
  });

  it('100점 환산은 소수 첫째 자리 반올림, 없으면 대시', () => {
    expect(formatScaleMean100(200 / 3)).toBe('66.7');
    expect(formatScaleMean100(250 / 3)).toBe('83.3');
    expect(formatScaleMean100(100)).toBe('100.0');
    expect(formatScaleMean100(0)).toBe('0.0');
    expect(formatScaleMean100(null)).toBe('—');
  });

  it('100점 환산 반올림은 이진 표현 오차에 내림되지 않는다', () => {
    // 83.35 × 10 = 833.4999… — toFixed(1) 은 83.3 을 낸다
    expect(formatScaleMean100(83.35)).toBe('83.4');
    expect(formatScaleMean100(1.05)).toBe('1.1');
    expect(formatScaleMean100(12.25)).toBe('12.3');
  });

  it('전체 줄 이름은 첫 줄~끝 줄 변수명이다', () => {
    const rows = summarizeScaleMeans(
      [radioQ('q1', 'Q1'), radioQ('q2', 'Q2'), radioQ('q3', 'Q3')],
      [],
    ).rows;
    expect(overallRowLabel(rows)).toBe('응답자별 평균 (Q1~Q3)');
    expect(overallRowLabel(rows.slice(0, 1))).toBe('응답자별 평균 (Q1)');
  });
});

describe('척도 평균 — 문항 고르기 후보', () => {
  it('켜면 척도 줄이 생기는 문항만 후보다 — 켜짐 여부와 줄 수를 함께 낸다', () => {
    const on = radioQ('q1', 'Q1');
    const off = radioQ('q2', 'Q2', { scaleMeanEnabled: false });
    const matrix = {
      ...matrixQ('m', 'Q7', ['시설', '프로그램']),
      scaleMeanEnabled: false,
    } as Question;
    const text = { id: 't', type: 'text', title: '이름', order: 1, required: false } as Question;
    const checkbox = { ...radioQ('c', 'Q9'), type: 'checkbox' } as Question;

    expect(listScaleMeanCandidates([on, off, matrix, text, checkbox])).toEqual([
      { questionId: 'q1', code: 'Q1', title: 'Q1. 만족하십니까?', rowCount: 1, enabled: true },
      { questionId: 'q2', code: 'Q2', title: 'Q2. 만족하십니까?', rowCount: 1, enabled: false },
      { questionId: 'm', code: 'Q7', title: 'Q7. 요소별 만족도', rowCount: 2, enabled: false },
    ]);
  });

  it('보기를 표 칸에서 가져오는 문항도 후보다', () => {
    const q = { ...choiceTableQ('q1', 'Q1'), scaleMeanEnabled: false };
    expect(listScaleMeanCandidates([q])).toMatchObject([
      { questionId: 'q1', rowCount: 1, enabled: false },
    ]);
  });
});

describe('척도 평균 — 고른 문항 검증', () => {
  const candidates = listScaleMeanCandidates([radioQ('q1', 'Q1'), radioQ('q2', 'Q2')]);

  it('후보 안의 문항만 받고 중복은 하나로 접는다', () => {
    expect(resolveScaleMeanSelection(candidates, ['q2', 'q1', 'q2'])).toEqual({
      ok: true,
      questionIds: ['q2', 'q1'],
    });
  });

  it('하나도 고르지 않아도 된다 — 전부 끈다', () => {
    expect(resolveScaleMeanSelection(candidates, [])).toEqual({ ok: true, questionIds: [] });
  });

  it('후보가 아닌 문항이 섞이면 아무것도 바꾸지 않고 거부한다', () => {
    expect(resolveScaleMeanSelection(candidates, ['q1', 'other'])).toEqual({
      ok: false,
      error: '평균을 낼 수 없는 문항이 섞여 있습니다. 화면을 새로고침한 뒤 다시 골라 주세요.',
    });
  });
});
