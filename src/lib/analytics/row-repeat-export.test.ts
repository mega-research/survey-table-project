import { describe, expect, it } from 'vitest';

import { expandRepeatRows } from '@/lib/question/row-repeat';
import type { Question, RowRepeatConfig, SurveySubmission, TableRow } from '@/types/survey';

import { assertValidSpssVarNames } from '@/lib/spss/variable-name-guard';

import { collectUsedRepeatCounts, repeatQuestionIds } from './row-repeat-usage';
import { buildDataRows, generateSPSSColumns } from './spss-excel-export';

/**
 * 뒤쪽 미사용 벌 pruning — 구조에는 20벌이 박혀 있어도 아무도 채우지 않은 벌의 열은
 * 내지 않는다. 앞 열의 이름과 순서는 사용 벌 수와 무관하게 같아야 한다 (설계 결정 2).
 */

const config: RowRepeatConfig = { enabled: true, templateRowIds: ['tpl'], maxRepeats: 5 };

function repeatQuestion(): Question {
  const seed: TableRow[] = [
    { id: 'head', label: '머리', rowCode: 'H', cells: [{ id: 'h1', type: 'input', content: '' }] },
    { id: 'tpl', label: '성과', rowCode: 'P', cells: [{ id: 't1', type: 'input', content: '' }] },
  ] as TableRow[];
  let n = 0;
  return {
    id: 'q1',
    type: 'table',
    title: '성과 표',
    required: false,
    order: 0,
    questionCode: 'QA1',
    tableColumns: [{ id: 'c1', label: '내용', columnCode: 'c1' }],
    tableRowsData: expandRepeatRows(seed, config, () => `gen${++n}`),
    rowRepeatConfig: config,
  } as Question;
}

const question = repeatQuestion();

function cellIdOfBundle(index: number): string {
  return question.tableRowsData!.find((r) => r.repeatIndex === index)!.cells[0]!.id;
}

function submission(responses: Record<string, unknown>): SurveySubmission {
  return { id: 's', questionResponses: { q1: responses } } as unknown as SurveySubmission;
}

function varNames(used?: Map<string, number>): string[] {
  return generateSPSSColumns([question], used ? { usedRepeatCounts: used } : undefined).map(
    (c) => c.spssVarName,
  );
}

describe('collectUsedRepeatCounts', () => {
  it('아무도 채우지 않았으면 1벌', () => {
    expect(collectUsedRepeatCounts([question], []).get('q1')).toBe(1);
  });

  it('설문 전체에서 값이 들어 있는 최대 벌을 센다', () => {
    const subs = [
      submission({ [cellIdOfBundle(1)]: '가' }),
      submission({ [cellIdOfBundle(3)]: '다' }),
    ];
    expect(collectUsedRepeatCounts([question], subs).get('q1')).toBe(3);
  });

  it('빈 문자열은 쓰인 것으로 치지 않는다', () => {
    const subs = [submission({ [cellIdOfBundle(4)]: '   ' })];
    expect(collectUsedRepeatCounts([question], subs).get('q1')).toBe(1);
  });

  it('반복 블록이 없는 질문은 담지 않는다', () => {
    const plain = { id: 'q2', type: 'table', title: '', order: 0, required: false } as Question;
    expect(collectUsedRepeatCounts([plain], []).has('q2')).toBe(false);
  });
});

describe('repeatQuestionIds', () => {
  it('반복 행을 가진 질문만 추린다', () => {
    const plain = { id: 'q2', type: 'table', title: '', order: 0, required: false } as Question;
    expect(repeatQuestionIds([question, plain])).toEqual(['q1']);
  });

  it('반복을 쓰지 않는 설문은 빈 목록이다 — 스캔 자체를 건너뛴다', () => {
    const plain = { id: 'q2', type: 'table', title: '', order: 0, required: false } as Question;
    expect(repeatQuestionIds([plain])).toEqual([]);
  });
});

describe('20벌 펼친 표의 변수명', () => {
  it('중복 없이 유일하다 — 발행 시점 변수명 게이트를 통과한다', () => {
    const seed: TableRow[] = [
      { id: 'head', label: '머리', cells: [{ id: 'h1', type: 'input', content: '' }] },
      { id: 'tpl', label: '성과', cells: [{ id: 't1', type: 'input', content: '' }] },
    ] as TableRow[];
    let n = 0;
    const wide = {
      ...question,
      tableRowsData: expandRepeatRows(
        seed,
        { enabled: true, templateRowIds: ['tpl'], maxRepeats: 20 },
        () => `w${++n}`,
      ),
    } as Question;
    const names = generateSPSSColumns([wide]).map((c) => c.spssVarName);
    expect(names).toHaveLength(21);
    expect(new Set(names).size).toBe(names.length);
    expect(assertValidSpssVarNames(generateSPSSColumns([wide]))).toBeUndefined();
  });
});

describe('generateSPSSColumns — 뒤쪽 미사용 벌 제외', () => {
  it('옵션이 없으면 구조에 있는 벌을 전부 낸다', () => {
    expect(varNames()).toEqual([
      'QA1_H_c1',
      'QA1_P_01_c1',
      'QA1_P_02_c1',
      'QA1_P_03_c1',
      'QA1_P_04_c1',
      'QA1_P_05_c1',
    ]);
  });

  it('3벌까지 쓰였으면 r04·r05 를 내지 않는다', () => {
    expect(varNames(new Map([['q1', 3]]))).toEqual([
      'QA1_H_c1',
      'QA1_P_01_c1',
      'QA1_P_02_c1',
      'QA1_P_03_c1',
    ]);
  });

  it('나중에 5벌이 쓰이면 뒤에 붙기만 하고 앞 열은 그대로다', () => {
    const three = varNames(new Map([['q1', 3]]));
    const five = varNames(new Map([['q1', 5]]));
    expect(five.slice(0, three.length)).toEqual(three);
    expect(five.slice(three.length)).toEqual(['QA1_P_04_c1', 'QA1_P_05_c1']);
  });

  it('아무도 채우지 않아도 1벌은 항상 낸다', () => {
    expect(varNames(new Map([['q1', 0]]))).toEqual(['QA1_H_c1', 'QA1_P_01_c1']);
  });

  it('비반복 행의 변수명은 pruning 과 무관하게 같다', () => {
    expect(varNames(new Map([['q1', 1]]))[0]).toBe(varNames()[0]);
  });
});

describe('선택 칸(드롭다운)이 든 반복 블록', () => {
  const selectConfig: RowRepeatConfig = { enabled: true, templateRowIds: ['tpl'], maxRepeats: 3 };
  let n = 0;
  const seed: TableRow[] = [
    {
      id: 'tpl',
      label: '품목',
      rowCode: 'r01',
      cells: [
        {
          id: 'sel',
          type: 'select',
          content: '',
          selectOptions: [
            { id: 'o1', label: '우유', value: '01', spssNumericCode: 1 },
            { id: 'o2', label: '가공유', value: '02', spssNumericCode: 2 },
            { id: 'o99', label: '기타', value: '99', spssNumericCode: 99, allowTextInput: true },
          ],
        },
      ],
    },
  ] as TableRow[];
  const q = {
    id: 'q3',
    type: 'table',
    title: '품목 표',
    required: false,
    order: 0,
    questionCode: 'QS',
    tableColumns: [{ id: 'c1', label: '품목', columnCode: 'c01' }],
    tableRowsData: expandRepeatRows(seed, selectConfig, () => `s${++n}`),
    rowRepeatConfig: selectConfig,
  } as Question;
  const selectIdOf = (bundle: number) =>
    q.tableRowsData!.find((r) => r.repeatIndex === bundle)!.cells[0]!.id;

  it('벌마다 제 선택 칸이 생기고 보기는 템플릿과 같다', () => {
    const cells = q.tableRowsData!.map((r) => r.cells[0]!);
    expect(new Set(cells.map((c) => c.id)).size).toBe(3);
    for (const c of cells) {
      expect(c.type).toBe('select');
      expect(c.selectOptions!.map((o) => o.value)).toEqual(['01', '02', '99']);
    }
  });

  it('고른 벌까지만 열을 내고, 상세 기재 열도 그 벌과 함께 빠진다', () => {
    const subs = [{ id: 's', questionResponses: { q3: { [selectIdOf(2)]: '02' } } }] as unknown as SurveySubmission[];
    const used = collectUsedRepeatCounts([q], subs);
    expect(used.get('q3')).toBe(2);
    const names = generateSPSSColumns([q], { usedRepeatCounts: used }).map((c) => c.spssVarName);
    assertValidSpssVarNames(generateSPSSColumns([q], { usedRepeatCounts: used }));
    expect(names.some((v) => v.startsWith('QS_r01_02_c01'))).toBe(true);
    expect(names.some((v) => v.startsWith('QS_r01_03'))).toBe(false);
    expect(names.filter((v) => v.endsWith('_text'))).toHaveLength(2);
  });

  it('벌마다 「기타」 상세 기재가 따로 저장되고 따로 내보내진다', () => {
    // 상세 기재는 __optTexts__[문항][보기 id] 에 산다 — 벌끼리 보기 id 가 같으면 나중 입력이 앞 벌을 덮는다.
    const otherIdOf = (bundle: number) =>
      q.tableRowsData!.find((r) => r.repeatIndex === bundle)!.cells[0]!.selectOptions!.find(
        (o) => o.value === '99',
      )!.id;
    expect(new Set([1, 2, 3].map(otherIdOf)).size).toBe(3);

    const sub = {
      id: 's',
      questionResponses: {
        q3: { [selectIdOf(1)]: '99', [selectIdOf(2)]: '99' },
        __optTexts__: { q3: { [otherIdOf(1)]: '치즈', [otherIdOf(2)]: '버터' } },
      },
    } as unknown as SurveySubmission;
    const used = collectUsedRepeatCounts([q], [sub]);
    const columns = generateSPSSColumns([q], { usedRepeatCounts: used });
    const row = buildDataRows(columns, [q], [sub])[0]!;
    const textValues = columns
      .map((c, i) => [c.spssVarName, row[i]] as const)
      .filter(([name]) => name.endsWith('_text'))
      .map(([, v]) => v);
    expect(textValues).toEqual(['치즈', '버터']);
  });
});

describe('라디오·체크박스 칸이 든 반복 블록', () => {
  const cfg: RowRepeatConfig = { enabled: true, templateRowIds: ['tpl'], maxRepeats: 3 };
  let n = 0;
  const seed: TableRow[] = [
    {
      id: 'tpl',
      label: '품목',
      rowCode: 'r01',
      cells: [
        {
          id: 'rad',
          type: 'radio',
          content: '',
          radioOptions: [
            { id: 'r1', label: '있음', value: '1', spssNumericCode: 1 },
            { id: 'r9', label: '기타', value: '9', spssNumericCode: 9, allowTextInput: true },
          ],
        },
        {
          id: 'chk',
          type: 'checkbox',
          content: '',
          checkboxOptions: [
            { id: 'k1', label: '가', value: '1', spssNumericCode: 1 },
            { id: 'k9', label: '기타', value: '9', spssNumericCode: 9, allowTextInput: true },
          ],
        },
      ],
    },
  ] as TableRow[];
  const q = {
    id: 'q4',
    type: 'table',
    title: '의향 표',
    required: false,
    order: 0,
    questionCode: 'QR',
    tableColumns: [
      { id: 'c1', label: '의향', columnCode: 'c01' },
      { id: 'c2', label: '항목', columnCode: 'c02' },
    ],
    tableRowsData: expandRepeatRows(seed, cfg, () => `x${++n}`),
    rowRepeatConfig: cfg,
  } as Question;
  const cellOf = (bundle: number, i: number) => q.tableRowsData!.find((r) => r.repeatIndex === bundle)!.cells[i]!;
  const otherOf = (bundle: number, i: number) =>
    (cellOf(bundle, i).radioOptions ?? cellOf(bundle, i).checkboxOptions)!.find((o) => o.value === '9')!.id;

  it('벌마다 라디오 값·체크박스 값·「기타」 상세 기재가 따로 내보내진다', () => {
    const sub = {
      id: 's',
      questionResponses: {
        q4: {
          [cellOf(1, 0).id]: '9',
          [cellOf(2, 0).id]: '1',
          [cellOf(1, 1).id]: ['9'],
          [cellOf(2, 1).id]: ['1', '9'],
        },
        __optTexts__: {
          q4: { [otherOf(1, 0)]: '라디오기타1', [otherOf(1, 1)]: '체크기타1', [otherOf(2, 1)]: '체크기타2' },
        },
      },
    } as unknown as SurveySubmission;
    const used = collectUsedRepeatCounts([q], [sub]);
    expect(used.get('q4')).toBe(2);
    const columns = generateSPSSColumns([q], { usedRepeatCounts: used });
    assertValidSpssVarNames(columns);
    const row = buildDataRows(columns, [q], [sub])[0]!;
    const byName = Object.fromEntries(columns.map((c, i) => [c.spssVarName, row[i]]));
    const texts = columns.filter((c) => c.spssVarName.endsWith('_text')).map((c) => byName[c.spssVarName]);
    expect(texts).toEqual(['라디오기타1', '체크기타1', null, '체크기타2']);
    expect(Object.keys(byName).filter((k) => k.startsWith('QR_r01_01'))).not.toEqual([]);
    expect(Object.keys(byName).filter((k) => k.startsWith('QR_r01_02'))).not.toEqual([]);
  });

  it('라디오 묶음 이름이 같은 칸도 벌마다 다른 변수가 된다', () => {
    const grouped = expandRepeatRows(
      [
        {
          id: 'tpl',
          label: '척도',
          rowCode: 'r01',
          cells: [1, 2].map((k) => ({
            id: `g${k}`,
            type: 'radio' as const,
            content: '',
            radioGroupName: 'scale',
            radioOptions: [{ id: `o${k}`, label: String(k), value: String(k), spssNumericCode: k }],
          })),
        },
      ] as TableRow[],
      cfg,
      () => `y${++n}`,
    );
    const gq = { ...q, id: 'q5', questionCode: 'QG', tableRowsData: grouped } as Question;
    const sub = {
      id: 's',
      questionResponses: { q5: { [grouped[0]!.cells[0]!.id]: '1', [grouped[1]!.cells[1]!.id]: '2' } },
    } as unknown as SurveySubmission;
    const used = collectUsedRepeatCounts([gq], [sub]);
    const columns = generateSPSSColumns([gq], { usedRepeatCounts: used });
    const row = buildDataRows(columns, [gq], [sub])[0]!;
    const values = columns.map((c, i) => [c.spssVarName, row[i]] as const);
    // 벌 두 개 = 라디오 묶음 변수 두 개, 각자 제 값
    expect(values.map(([, v]) => v)).toEqual([1, 2]);
  });
});
