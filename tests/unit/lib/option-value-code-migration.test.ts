import { describe, expect, it } from 'vitest';

import {
  applyQuestionOptionPlan,
  buildCellValueMaps,
  buildOrphanScope,
  buildQuestionValueMap,
  buildValueMap,
  countExpressionExposure,
  countOrphansByQuestion,
  countOrphanValues,
  diffOrphanCounts,
  mergeValueMaps,
  planOptionArrayMigration,
  planQuestionOptions,
  remapConditionGroup,
  remapQuestionResponses,
  remapResponseValue,
  remapSnapshot,
  remapTableColumns,
  remapTableRows,
  summarizeQuestionPlan,
  type ConditionRemapMaps,
  type OptionValueChange,
} from '@/lib/option-value-code-migration';

const noMaps: ConditionRemapMaps = { byQuestion: new Map(), byQuestionCells: new Map() };

describe('planOptionArrayMigration', () => {
  it('커스텀 코드가 value 와 다르면 value 를 코드로 맞춘다', () => {
    const options = [
      { id: 'a', label: '① 있다', value: '옵션1', optionCode: '1', isCustomOptionCode: true },
      { id: 'b', label: '② 없다', value: '옵션2', optionCode: '2', isCustomOptionCode: true },
    ];

    const plan = planOptionArrayMigration(options);

    expect(plan.changed).toBe(true);
    expect(plan.options.map((o) => o['value'])).toEqual(['1', '2']);
    expect(plan.changes).toEqual([
      { optionId: 'a', label: '① 있다', oldValue: '옵션1', newValue: '1' },
      { optionId: 'b', label: '② 없다', oldValue: '옵션2', newValue: '2' },
    ]);
    expect(plan.skipped).toEqual([]);
    // 원본 불변
    expect(options[0]?.value).toBe('옵션1');
  });

  it('value 와 optionCode 가 같으면 no-op 이다', () => {
    const options = [{ id: 'a', value: '16', optionCode: '16', isCustomOptionCode: true }];

    const plan = planOptionArrayMigration(options);

    expect(plan.changed).toBe(false);
    expect(plan.options).toBe(options);
    expect(plan.changes).toEqual([]);
    expect(plan.excludedNonCustom).toBe(0);
  });

  it('isCustomOptionCode 가 true 가 아니면 자동 발번으로 보고 제외한다', () => {
    // 표 셀 옵션에 자동 발번 코드가 strip 되지 않고 남아 있는 실제 데이터 형태
    const options = [
      { id: 'a', value: 'option-1', optionCode: '1' }, // isCustomOptionCode 부재
      { id: 'b', value: '옵션2', optionCode: '2', isCustomOptionCode: false },
    ];

    const plan = planOptionArrayMigration(options);

    expect(plan.changed).toBe(false);
    expect(plan.changes).toEqual([]);
    expect(plan.excludedNonCustom).toBe(2);
  });

  it('다른 옵션의 value 와 충돌하면 스킵하고 기록한다', () => {
    const options = [
      { id: 'a', value: '옵션1', optionCode: '2', isCustomOptionCode: true },
      { id: 'b', value: '2', optionCode: undefined },
    ];

    const plan = planOptionArrayMigration(options);

    expect(plan.changed).toBe(false);
    expect(plan.skipped).toEqual([
      { optionId: 'a', label: '', value: '옵션1', optionCode: '2', reason: 'collision' },
    ]);
  });

  it('다른 옵션이 같은 optionCode 를 예약하고 있으면 스킵한다', () => {
    const options = [
      { id: 'a', value: '옵션1', optionCode: '3', isCustomOptionCode: true },
      { id: 'b', value: '옵션2', optionCode: '3', isCustomOptionCode: true },
    ];

    const plan = planOptionArrayMigration(options);

    expect(plan.changed).toBe(false);
    expect(plan.skipped).toHaveLength(2);
  });

  it('실제 데이터(Q11) — 기타 옵션 value 10 이 코드 9 로 내려가고 나머지는 순번으로 정렬된다', () => {
    const options = Array.from({ length: 8 }, (_, i) => ({
      id: `o${i + 1}`,
      value: `옵션${i + 1}`,
      optionCode: String(i + 1),
      isCustomOptionCode: true,
    }));
    options.push({ id: 'etc', value: '10', optionCode: '9', isCustomOptionCode: true });

    const plan = planOptionArrayMigration(options);

    expect(plan.skipped).toEqual([]);
    expect(plan.options.map((o) => o['value'])).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('배열이 아니면 빈 계획을 돌려준다', () => {
    expect(planOptionArrayMigration(null).changed).toBe(false);
    expect(planOptionArrayMigration(undefined).changes).toEqual([]);
    expect(planOptionArrayMigration({ options: [] }).skipped).toEqual([]);
  });
});

describe('mergeValueMaps', () => {
  it('같은 old 가 다른 new 로 갈리면 해당 키를 버리고 conflicts 에 남긴다', () => {
    const merged = mergeValueMaps([
      new Map([['a', '1'], ['b', '2']]),
      new Map([['a', '9']]),
    ]);

    expect(merged.map.has('a')).toBe(false);
    expect(merged.map.get('b')).toBe('2');
    expect(merged.conflicts).toEqual(['a']);
  });
});

describe('planQuestionOptions / applyQuestionOptionPlan', () => {
  const source = {
    id: 'q1',
    options: [{ id: 'a', value: '옵션1', optionCode: '1', isCustomOptionCode: true }],
    selectLevels: [
      { id: 'lv1', options: [{ id: 's1', value: '옵션9', optionCode: '9', isCustomOptionCode: true }] },
    ],
    rankingConfig: {
      positions: 3,
      options: [{ id: 'r1', value: '옵션7', optionCode: '7', isCustomOptionCode: true }],
    },
    tableRowsData: [
      {
        id: 'row1',
        cells: [
          {
            id: 'cell1',
            type: 'radio',
            radioOptions: [{ id: 'c1', value: 'option-1', optionCode: '1', isCustomOptionCode: true }],
          },
          { id: 'cell2', type: 'input' },
        ],
      },
    ],
  };

  it('옵션 배열 6종을 모두 스캔한다', () => {
    const plan = planQuestionOptions(source);
    const summary = summarizeQuestionPlan(plan);

    expect(summary.changes.map((c) => `${c.oldValue}->${c.newValue}`).sort()).toEqual([
      'option-1->1',
      '옵션1->1',
      '옵션7->7',
      '옵션9->9',
    ]);
    expect(plan.cells).toHaveLength(1);
    expect(plan.cells[0]?.cellId).toBe('cell1');
  });

  it('계획을 적용하면 각 경로의 value 가 코드로 바뀐다', () => {
    const plan = planQuestionOptions(source);
    const applied = applyQuestionOptionPlan(source, plan);

    expect(applied.changed).toBe(true);
    expect((applied.options as Array<Record<string, unknown>>)[0]?.['value']).toBe('1');
    const levels = applied.selectLevels as Array<{ options: Array<Record<string, unknown>> }>;
    expect(levels[0]?.options[0]?.['value']).toBe('9');
    const ranking = applied.rankingConfig as { options: Array<Record<string, unknown>> };
    expect(ranking.options[0]?.['value']).toBe('7');
    const rows = applied.tableRowsData as Array<{ cells: Array<Record<string, unknown>> }>;
    const radioOptions = rows[0]?.cells[0]?.['radioOptions'] as Array<Record<string, unknown>>;
    expect(radioOptions[0]?.['value']).toBe('1');
    // input 셀은 손대지 않는다
    expect(rows[0]?.cells[1]).toEqual({ id: 'cell2', type: 'input' });
    // 원본 불변
    expect(source.options[0]?.value).toBe('옵션1');
  });

  it('질문/셀 value map 을 스코프별로 만든다', () => {
    const plan = planQuestionOptions(source);

    expect([...buildQuestionValueMap(plan)]).toEqual([
      ['옵션1', '1'],
      ['옵션7', '7'],
      ['옵션9', '9'],
    ]);
    expect([...(buildCellValueMaps(plan).get('cell1') ?? [])]).toEqual([['option-1', '1']]);
  });
});

describe('remapConditionGroup', () => {
  const maps: ConditionRemapMaps = {
    byQuestion: new Map([['q-src', new Map([['4', '1']])]]),
    byQuestionCells: new Map([['q-src', new Map([['option-2', '2']])]]),
  };

  it('requiredValues 를 질문 레벨 맵으로 치환한다', () => {
    const group = {
      logicType: 'AND',
      conditions: [
        { id: 'c1', sourceQuestionId: 'q-src', conditionType: 'value-match', requiredValues: ['4'], logicType: 'AND' },
      ],
    };

    const result = remapConditionGroup(group, maps);

    expect(result.count).toBe(1);
    const conditions = (result.value as { conditions: Array<Record<string, unknown>> }).conditions;
    expect(conditions[0]?.['requiredValues']).toEqual(['1']);
  });

  it('tableConditions/additionalConditions 의 expectedValues 는 셀 맵으로 치환한다', () => {
    const group = {
      logicType: 'AND',
      conditions: [
        {
          id: 'c1',
          sourceQuestionId: 'q-src',
          conditionType: 'table-cell-check',
          tableConditions: { rowIds: ['r1'], checkType: 'any', expectedValues: ['option-2'] },
          additionalConditions: { cellColumnIndex: 1, checkType: 'radio', expectedValues: ['option-2', 'zzz'] },
          logicType: 'AND',
        },
      ],
    };

    const result = remapConditionGroup(group, maps);

    expect(result.count).toBe(2);
    const condition = (result.value as { conditions: Array<Record<string, unknown>> }).conditions[0];
    expect((condition?.['tableConditions'] as { expectedValues: string[] }).expectedValues).toEqual(['2']);
    expect((condition?.['additionalConditions'] as { expectedValues: string[] }).expectedValues).toEqual(['2', 'zzz']);
  });

  it('다른 질문을 참조하는 조건은 건드리지 않고 원본 참조를 유지한다', () => {
    const group = {
      logicType: 'AND',
      conditions: [{ id: 'c1', sourceQuestionId: 'other', requiredValues: ['4'], logicType: 'AND' }],
    };

    const result = remapConditionGroup(group, maps);

    expect(result.count).toBe(0);
    expect(result.value).toBe(group);
  });
});

describe('remapTableRows / remapTableColumns', () => {
  it('셀 게이팅 values 를 controllerCellId 기준으로 치환한다', () => {
    const rows = [
      {
        id: 'row1',
        cells: [
          { id: 'ctrl', type: 'radio' },
          { id: 'target', type: 'input', enabledWhen: { kind: 'option', controllerCellId: 'ctrl', values: ['option-1', 'option-3'] } },
          { id: 'other', type: 'input', enabledWhen: { kind: 'option', controllerCellId: 'zzz', values: ['option-1'] } },
        ],
      },
    ];
    const cellMaps = new Map([['ctrl', new Map([['option-1', '1']])]]);

    const result = remapTableRows(rows, noMaps, cellMaps);

    expect(result.gatingCount).toBe(1);
    const nextRows = result.value as Array<{ cells: Array<Record<string, unknown>> }>;
    expect((nextRows[0]?.cells[1]?.['enabledWhen'] as { values: string[] }).values).toEqual(['1', 'option-3']);
    expect((nextRows[0]?.cells[2]?.['enabledWhen'] as { values: string[] }).values).toEqual(['option-1']);
  });

  it('행/열 displayCondition 도 리매핑한다', () => {
    const maps: ConditionRemapMaps = {
      byQuestion: new Map([['q-src', new Map([['옵션1', '1']])]]),
      byQuestionCells: new Map(),
    };
    const condition = {
      logicType: 'AND',
      conditions: [{ id: 'c', sourceQuestionId: 'q-src', requiredValues: ['옵션1'], logicType: 'AND' }],
    };

    const rows = remapTableRows([{ id: 'r1', cells: [], displayCondition: condition }], maps, new Map());
    const columns = remapTableColumns([{ id: 'col1', label: 'A', displayCondition: condition }], maps);

    expect(rows.conditionCount).toBe(1);
    expect(columns.count).toBe(1);
  });

  it('변경이 없으면 원본 참조를 그대로 돌려준다', () => {
    const rows = [{ id: 'r1', cells: [{ id: 'c1' }] }];
    expect(remapTableRows(rows, noMaps, new Map()).value).toBe(rows);
  });
});

describe('remapResponseValue', () => {
  const questionSpec = { questionMap: new Map([['옵션1', '1'], ['10', '9']]), cellMaps: null };

  it('radio/select 단일 문자열을 정확 일치로 치환한다', () => {
    expect(remapResponseValue('옵션1', questionSpec)).toEqual({ value: '1', count: 1 });
    expect(remapResponseValue('옵션11', questionSpec)).toEqual({ value: '옵션11', count: 0 });
  });

  it('checkbox 배열을 원소 단위로 치환한다', () => {
    const result = remapResponseValue(['옵션1', '옵션2', '10'], questionSpec);
    expect(result).toEqual({ value: ['1', '옵션2', '9'], count: 2 });
  });

  it('순위형 응답의 optionValue 를 치환한다', () => {
    const result = remapResponseValue(
      [{ rank: 1, optionValue: '옵션1' }, { rank: 2, optionValue: 'zzz' }],
      questionSpec,
    );
    expect(result.count).toBe(1);
    expect(result.value).toEqual([{ rank: 1, optionValue: '1' }, { rank: 2, optionValue: 'zzz' }]);
  });

  it('table 응답 객체는 cellMaps 에 있는 셀만 치환하고 input 셀 자유 텍스트는 보존한다', () => {
    const spec = {
      questionMap: null,
      cellMaps: new Map([
        ['cell-radio', new Map([['option-1', '1']])],
        ['cell-cb', new Map([['option-2', '2']])],
      ]),
    };
    const value = {
      'cell-radio': 'option-1',
      'cell-cb': ['option-2', 'option-9'],
      'cell-input': 'option-1', // 자유 텍스트가 우연히 같은 문자열이어도 건드리지 않는다
      __optTexts__: { x: 'option-1' },
    };

    const result = remapResponseValue(value, spec);

    expect(result.count).toBe(2);
    expect(result.value).toEqual({
      'cell-radio': '1',
      'cell-cb': ['2', 'option-9'],
      'cell-input': 'option-1',
      __optTexts__: { x: 'option-1' },
    });
  });

  it('response_answers 의 __array 컨테이너도 동일하게 치환한다', () => {
    const result = remapResponseValue({ __array: ['옵션1', { rank: 1, optionValue: '10' }] }, questionSpec);
    expect(result).toEqual({ value: { __array: ['1', { rank: 1, optionValue: '9' }] }, count: 2 });
  });

  it('변경이 없으면 원본 참조를 유지한다', () => {
    const value = { 'cell-x': 'y' };
    expect(remapResponseValue(value, { questionMap: null, cellMaps: new Map() }).value).toBe(value);
  });
});

describe('remapQuestionResponses', () => {
  it('스펙에 등록된 질문만 치환하고 사이드카 키는 건너뛴다', () => {
    const responses = {
      q1: '옵션1',
      q2: ['옵션1'],
      __optTexts__: { q1: { 'opt-id': '기타 입력' } },
    };
    const specs = new Map([['q1', { questionMap: new Map([['옵션1', '1']]), cellMaps: null }]]);

    const result = remapQuestionResponses(responses, specs);

    expect(result.count).toBe(1);
    expect(result.value).toEqual({
      q1: '1',
      q2: ['옵션1'],
      __optTexts__: { q1: { 'opt-id': '기타 입력' } },
    });
  });
});

describe('remapSnapshot', () => {
  const change: OptionValueChange = { optionId: 'a', label: '', oldValue: '옵션1', newValue: '1' };

  it('옵션 id 로 매칭해 value/optionCode 를 동기화한다', () => {
    const snapshot = {
      questions: [
        {
          id: 'q1',
          options: [
            { id: 'a', value: '옵션1', optionCode: '1', isCustomOptionCode: true },
            { id: 'b', value: '옵션2' },
          ],
        },
      ],
      groups: [],
    };
    const optionChanges = new Map([['q1', new Map([['a', change]])]]);

    const result = remapSnapshot(snapshot, optionChanges, new Map(), noMaps, new Map());

    expect(result.optionCount).toBe(1);
    const options = (result.snapshot as { questions: Array<{ options: Array<Record<string, unknown>> }> })
      .questions[0]?.options;
    expect(options?.[0]).toEqual({ id: 'a', value: '1', optionCode: '1', isCustomOptionCode: true });
    expect(options?.[1]).toEqual({ id: 'b', value: '옵션2' });
  });

  it('스냅샷 옵션 value 가 old 와 다르면 다른 세대로 보고 건드리지 않는다', () => {
    const snapshot = {
      questions: [{ id: 'q1', options: [{ id: 'a', value: '완전히다른값' }] }],
      groups: [],
    };

    const result = remapSnapshot(snapshot, new Map([['q1', new Map([['a', change]])]]), new Map(), noMaps, new Map());

    expect(result.changed).toBe(false);
    expect(result.snapshot).toBe(snapshot);
  });

  it('옵션 id 가 다른 세대 사본이면 value 로 폴백 매칭하고 상세를 남긴다', () => {
    // 실제 데이터: 옛 스냅샷의 기타 옵션이 현행과 다른 id 로 복제되어 있다
    const snapshot = {
      questions: [
        { id: 'q1', options: [{ id: '옛날id', value: '옵션1', label: '① 옛 라벨' }, { id: 'z', value: '옵션2' }] },
      ],
      groups: [],
    };

    const result = remapSnapshot(snapshot, new Map([['q1', new Map([['a', change]])]]), new Map(), noMaps, new Map());

    expect(result.optionCount).toBe(1);
    expect(result.optionByValueCount).toBe(1);
    expect(result.optionConflictCount).toBe(0);
    // 육안 대조용 상세 — 어느 질문의 어떤 옵션이 폴백으로 바뀌었는지 지목 가능해야 한다
    expect(result.optionByValueDetails).toEqual([
      { change, snapshotLabel: '① 옛 라벨', snapshotOptionId: '옛날id', questionId: 'q1' },
    ]);
    const options = (result.snapshot as { questions: Array<{ options: Array<Record<string, unknown>> }> })
      .questions[0]?.options;
    expect(options?.[0]).toEqual({
      id: '옛날id',
      value: '1',
      label: '① 옛 라벨',
      optionCode: '1',
      isCustomOptionCode: true,
    });
  });

  it('폴백 대상이 여럿이거나 새 value 가 이미 쓰이면 강행하지 않고 conflicts 로 센다', () => {
    const taken = {
      questions: [{ id: 'q1', options: [{ id: 'x', value: '옵션1' }, { id: 'y', value: '1' }] }],
      groups: [],
    };
    const ambiguous = {
      questions: [{ id: 'q1', options: [{ id: 'x', value: '옵션1' }, { id: 'y', value: '옵션1' }] }],
      groups: [],
    };
    const changes = new Map([['q1', new Map([['a', change]])]]);

    const takenResult = remapSnapshot(taken, changes, new Map(), noMaps, new Map());
    const ambiguousResult = remapSnapshot(ambiguous, changes, new Map(), noMaps, new Map());

    expect(takenResult.changed).toBe(false);
    expect(takenResult.optionConflictCount).toBe(1);
    expect(ambiguousResult.changed).toBe(false);
    expect(ambiguousResult.optionConflictCount).toBe(1);
  });

  it('스냅샷 안 그룹 표시조건도 리매핑한다', () => {
    const maps: ConditionRemapMaps = {
      byQuestion: new Map([['q1', new Map([['옵션1', '1']])]]),
      byQuestionCells: new Map(),
    };
    const snapshot = {
      questions: [],
      groups: [
        {
          id: 'g1',
          displayCondition: {
            logicType: 'AND',
            conditions: [{ id: 'c', sourceQuestionId: 'q1', requiredValues: ['옵션1'], logicType: 'AND' }],
          },
        },
      ],
    };

    const result = remapSnapshot(snapshot, new Map(), new Map(), maps, new Map());

    expect(result.conditionCount).toBe(1);
    expect(result.changed).toBe(true);
  });
});

describe('orphan 검증', () => {
  const source = {
    id: 'q1',
    options: [{ id: 'a', value: '옵션1' }, { id: 'b', value: '옵션2' }],
    selectLevels: null,
    rankingConfig: null,
    tableRowsData: [
      {
        id: 'r1',
        cells: [{ id: 'cell1', type: 'radio', radioOptions: [{ id: 'c', value: 'option-1' }] }],
      },
    ],
  };

  it('옵션 value 집합에 없는 응답을 센다', () => {
    const scopes = new Map([['q1', buildOrphanScope(source)]]);

    expect(countOrphanValues({ q1: '옵션1' }, scopes)).toBe(0);
    expect(countOrphanValues({ q1: '옵션9' }, scopes)).toBe(1);
    expect(countOrphanValues({ q1: ['옵션1', '옵션9', 'zzz'] }, scopes)).toBe(2);
  });

  it('질문별 델타로 원인 질문을 지목할 수 있다', () => {
    const scopes = new Map([['q1', buildOrphanScope(source)]]);

    expect([...countOrphansByQuestion({ q1: ['옵션9', 'zzz'] }, scopes)]).toEqual([['q1', 2]]);
    expect([...countOrphansByQuestion({ q1: '옵션1' }, scopes)]).toEqual([]);
  });

  it('table 응답은 셀 옵션 집합 기준으로 센다 — 미등록 셀(input)은 세지 않는다', () => {
    const scopes = new Map([['q1', buildOrphanScope(source)]]);

    expect(countOrphanValues({ q1: { cell1: 'option-1', 'cell-input': '자유 텍스트' } }, scopes)).toBe(0);
    expect(countOrphanValues({ q1: { cell1: 'option-9' } }, scopes)).toBe(1);
  });

  it('마이그레이션 전후 orphan 수가 보존된다 (응답까지 함께 리매핑한 경우)', () => {
    const before = {
      id: 'q1',
      options: [
        { id: 'a', value: '옵션1', optionCode: '1', isCustomOptionCode: true },
        { id: 'b', value: '10', optionCode: '9', isCustomOptionCode: true },
      ],
      selectLevels: null,
      rankingConfig: null,
      tableRowsData: null,
    };
    const responses = { q1: ['옵션1', '10', '이미고아'] };

    const beforeCount = countOrphanValues(responses, new Map([['q1', buildOrphanScope(before)]]));

    const plan = planQuestionOptions(before);
    const applied = applyQuestionOptionPlan(before, plan);
    const after = { ...before, options: applied.options };
    const remapped = remapQuestionResponses(
      responses,
      new Map([['q1', { questionMap: buildQuestionValueMap(plan), cellMaps: null }]]),
    );
    const afterCount = countOrphanValues(remapped.value, new Map([['q1', buildOrphanScope(after)]]));

    expect(beforeCount).toBe(1);
    expect(afterCount).toBe(1);
    expect(remapped.value).toEqual({ q1: ['1', '9', '이미고아'] });
  });

  it('응답을 리매핑하지 않으면 orphan 이 늘어난다 (검증 로직이 실제로 잡아내는지)', () => {
    const before = {
      id: 'q1',
      options: [{ id: 'a', value: '옵션1', optionCode: '1', isCustomOptionCode: true }],
      selectLevels: null,
      rankingConfig: null,
      tableRowsData: null,
    };
    const responses = { q1: '옵션1' };
    const plan = planQuestionOptions(before);
    const after = { ...before, options: applyQuestionOptionPlan(before, plan).options };

    expect(countOrphanValues(responses, new Map([['q1', buildOrphanScope(before)]]))).toBe(0);
    expect(countOrphanValues(responses, new Map([['q1', buildOrphanScope(after)]]))).toBe(1);
  });
});

describe('diffOrphanCounts', () => {
  it('총합이 같아도 한 스코프가 증가하면 실패로 판정한다 (상쇄 게이트 우회 차단)', () => {
    // q1 은 3 감소(정상), q2 는 3 증가(사고) — 총합은 10 으로 동일
    const before = new Map([['q1', 5], ['q2', 5]]);
    const after = new Map([['q1', 2], ['q2', 8]]);

    const diff = diffOrphanCounts(before, after);

    expect(diff.beforeTotal).toBe(10);
    expect(diff.afterTotal).toBe(10);
    expect(diff.hasIncrease).toBe(true);
    expect(diff.increased).toEqual([['q2', 3]]);
    expect(diff.decreased).toEqual([['q1', 3]]);
  });

  it('총합이 줄어도 신규 orphan 이 난 스코프가 있으면 실패로 판정한다', () => {
    const before = new Map([['q1', 10]]);
    const after = new Map([['q1', 1], ['q2', 2]]);

    const diff = diffOrphanCounts(before, after);

    expect(diff.afterTotal).toBeLessThan(diff.beforeTotal);
    expect(diff.hasIncrease).toBe(true);
    expect(diff.increased).toEqual([['q2', 2]]);
  });

  it('감소만 있으면 정상 통과', () => {
    const diff = diffOrphanCounts(new Map([['q1', 5], ['q2', 3]]), new Map([['q1', 2]]));

    expect(diff.hasIncrease).toBe(false);
    expect(diff.increased).toEqual([]);
    expect(diff.decreased).toEqual([['q1', 3], ['q2', 3]]);
  });

  it('전후 동일하면 통과', () => {
    expect(diffOrphanCounts(new Map([['q1', 5]]), new Map([['q1', 5]])).hasIncrease).toBe(false);
  });

  it('증가량 내림차순으로 정렬해 원인 지목을 앞세운다', () => {
    const diff = diffOrphanCounts(new Map(), new Map([['q1', 1], ['q2', 7], ['q3', 3]]));

    expect(diff.increased).toEqual([['q2', 7], ['q3', 3], ['q1', 1]]);
  });
});

describe('countExpressionExposure', () => {
  const candidates = new Set(['q-cand']);

  const expressionCondition = (config: unknown, sourceQuestionId = 'q-other') => ({
    logicType: 'AND',
    conditions: [
      { id: 'c1', sourceQuestionId, conditionType: 'expression', expressionConfig: config, logicType: 'AND' },
    ],
  });

  it('expression 이 아닌 조건은 세지 않는다', () => {
    const group = {
      logicType: 'AND',
      conditions: [{ id: 'c', sourceQuestionId: 'q-cand', conditionType: 'value-match', requiredValues: ['1'], logicType: 'AND' }],
    };

    expect(countExpressionExposure(group, candidates)).toEqual({ total: 0, exposed: 0 });
  });

  it('후보 질문을 참조하지 않는 expression 은 노출 0', () => {
    const group = expressionCondition({
      clauses: [
        {
          kind: 'comparison',
          comparison: { left: { kind: 'question', questionId: 'q-other' }, op: '==', right: { kind: 'literal', value: '옵션1' } },
        },
      ],
      joinOps: [],
    });

    expect(countExpressionExposure(group, candidates)).toEqual({ total: 1, exposed: 0 });
  });

  it('kind question 으로 후보 질문을 참조하면 노출로 센다', () => {
    const group = expressionCondition({
      clauses: [
        {
          kind: 'comparison',
          comparison: { left: { kind: 'question', questionId: 'q-cand' }, op: '==', right: { kind: 'literal', value: '옵션1' } },
        },
      ],
      joinOps: [],
    });

    expect(countExpressionExposure(group, candidates)).toEqual({ total: 1, exposed: 1 });
  });

  it('중첩 group/binop 안의 cell 참조도 찾아낸다', () => {
    const group = expressionCondition({
      clauses: [
        {
          kind: 'group',
          group: {
            clauses: [
              {
                kind: 'comparison',
                comparison: {
                  left: {
                    kind: 'binop',
                    op: '+',
                    left: { kind: 'literal', value: 1 },
                    right: { kind: 'cell', questionId: 'q-cand', cellId: 'c1' },
                  },
                  op: '>',
                  right: { kind: 'literal', value: 3 },
                },
              },
            ],
            joinOps: [],
          },
        },
      ],
      joinOps: [],
    });

    expect(countExpressionExposure(group, candidates)).toEqual({ total: 1, exposed: 1 });
  });

  it('sourceQuestionId 가 후보면 expressionConfig 가 비어도 노출로 센다', () => {
    expect(countExpressionExposure(expressionCondition(undefined, 'q-cand'), candidates)).toEqual({
      total: 1,
      exposed: 1,
    });
  });
});

describe('buildValueMap', () => {
  it('동시 적용용 맵을 만든다 — 순차 체이닝이 일어나지 않는다', () => {
    const map = buildValueMap([
      { optionId: 'a', label: '', oldValue: 'A', newValue: 'B' },
      { optionId: 'b', label: '', oldValue: 'B', newValue: 'C' },
    ]);

    const result = remapResponseValue(['A', 'B'], { questionMap: map, cellMaps: null });

    expect(result.value).toEqual(['B', 'C']);
  });
});
