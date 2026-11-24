import { describe, expect, it } from 'vitest';

import { projectRowScaleSliders } from '@/features/question-renderer/utils/row-scale-bars';
import type { ScaleSliderFallbackReason } from '@/features/question-renderer/utils/scale-slider';
import { tableHasScaleSliderRow } from '@/features/question-renderer/utils/scale-slider-table-layout';
import {
  RADIO_OPTION_SLIDER_FALLBACK_MESSAGES,
  RADIO_SLIDER_CRAMPED_TILE_MIN_TICKS,
  SCALE_SLIDER_FALLBACK_MESSAGES,
  diagnoseChoiceGroupScaleSlider,
  diagnoseQuestionScaleSlider,
  diagnoseTableScaleSliders,
  summarizeTableScaleSlider,
} from '@/features/survey-builder/lib/scale-slider-diagnostics';
import type {
  ChoiceGroup,
  HeaderCell,
  Question,
  QuestionOption,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';

/**
 * 척도 슬라이더 폴백 진단 — 빌더가 응답 화면과 같은 투영을 돌려, 슬라이더로 못 그리는 행과 이유를 낸다
 * (CONTEXT.md 「척도 슬라이더」). 여기서 보는 것은 「투영과 같은 이유·같은 행」이다.
 */

const MARKS = ['①', '②', '③', '④', '⑤'];
const slider: ChoiceGroup = {
  id: 'g-sat',
  groupKey: 'rad1',
  type: 'radio',
  label: '만족도',
  scaleSlider: 'positive-right',
};

const choice = (id: string, content: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'choice_opt',
  content,
  choiceGroupId: 'g-sat',
  ...extra,
});

function scaleRow(
  id: string,
  label: string,
  edit: (cell: TableCell, n: number) => TableCell = (cell) => cell,
  groupId: string | undefined = 'g-sat',
): TableRow {
  return {
    id,
    label,
    cells: [
      { id: `${id}-item`, type: 'text', content: label },
      ...MARKS.map((text, n) => {
        const cell = edit(choice(`${id}-c${n}`, text), n);
        if (groupId !== undefined) return { ...cell, choiceGroupId: groupId };
        const { choiceGroupId: _group, ...ungrouped } = cell;
        return ungrouped;
      }),
    ],
  };
}

const columns: TableColumn[] = Array.from({ length: 6 }, (_, n) => ({ id: `col${n}`, label: '' }));

const groupInput = (rows: TableRow[], groups: ChoiceGroup[] = [slider]) => ({
  groupId: 'g-sat',
  rows,
  columns,
  choiceGroups: groups,
  ungroupedSelectionType: null,
});

describe('diagnoseChoiceGroupScaleSlider — 슬라이더 묶음의 폴백 진단', () => {
  it('모든 행이 슬라이더로 그려지면 문제가 없다', () => {
    const rows = [scaleRow('r1', '회의실 지원'), scaleRow('r2', '교통비 지원')];
    expect(diagnoseChoiceGroupScaleSlider(groupInput(rows))).toEqual({
      issues: [],
      drawsNothing: false,
    });
  });

  it('폴백하는 행을 이유별로 모아 행 이름과 문구를 준다', () => {
    const rows = [
      scaleRow('r1', '회의실 지원', (cell, n) =>
        n === 4 ? { ...cell, allowTextInput: true } : cell,
      ),
      scaleRow('r2', '교통비 지원'),
      scaleRow('r3', '멘토링', (cell, n) => (n === 4 ? { ...cell, allowTextInput: true } : cell)),
    ];
    expect(diagnoseChoiceGroupScaleSlider(groupInput(rows))).toEqual({
      issues: [
        {
          reason: 'text-input',
          message: SCALE_SLIDER_FALLBACK_MESSAGES['text-input'],
          rowLabels: ['회의실 지원', '멘토링'],
        },
      ],
      drawsNothing: false,
    });
  });

  // 행 배치가 낼 수 있는 이유 다섯 — 행 하나를 그 이유로 망가뜨려, 진단이 투영(projectRowScaleSliders)과
  // 같은 이유를 내는지 본다. 나머지 둘(복수 선택 · 보기 칸 아님)은 아래 「일곱 이유」 테스트가 본다.
  const broken: Partial<Record<ScaleSliderFallbackReason, TableRow>> = {
    // 눈금 사이에 「평균에서 제외」 보기가 끼면 눈금이 끊긴다
    'non-contiguous': scaleRow('r1', '회의실 지원', (cell, n) =>
      n === 2 ? { ...cell, excludeFromMean: true } : cell,
    ),
    // 눈금이 하나뿐이다(나머지는 척도 밖 보기)
    'cell-count': scaleRow('r1', '회의실 지원', (cell, n) =>
      n > 0 ? { ...cell, excludeFromMean: true } : cell,
    ),
    'text-input': scaleRow('r1', '회의실 지원', (cell, n) =>
      n === 4 ? { ...cell, allowTextInput: true } : cell,
    ),
    'exclusive-choice': scaleRow('r1', '회의실 지원', (cell, n) =>
      n === 4 ? { ...cell, exclusiveChoice: true } : cell,
    ),
    'missing-text': scaleRow('r1', '회의실 지원', (cell, n) =>
      n === 1 ? { ...cell, content: '' } : cell,
    ),
  };

  it.each(Object.keys(broken) as ScaleSliderFallbackReason[])(
    '이유 %s — 투영과 같은 이유·같은 행을 낸다',
    (reason) => {
      const rows = [scaleRow('r0', '교통비 지원'), broken[reason]!];
      const projected = projectRowScaleSliders({
        columns,
        barHeaderGrid: undefined,
        row: rows[1]!,
        choiceGroups: [slider],
        ungroupedSelectionType: null,
      });
      expect(projected.fallbacks.map((fallback) => fallback.reason)).toEqual([reason]);

      expect(diagnoseChoiceGroupScaleSlider(groupInput(rows))).toEqual({
        issues: [
          { reason, message: SCALE_SLIDER_FALLBACK_MESSAGES[reason], rowLabels: ['회의실 지원'] },
        ],
        drawsNothing: false,
      });
    },
  );

  it('일곱 이유 모두 문구가 있고 서로 다르다', () => {
    const reasons = Object.keys({
      'not-single-choice': true,
      'non-choice-cell': true,
      'non-contiguous': true,
      'cell-count': true,
      'text-input': true,
      'exclusive-choice': true,
      'missing-text': true,
    } satisfies Record<ScaleSliderFallbackReason, true>) as ScaleSliderFallbackReason[];
    const messages = reasons.map((reason) => SCALE_SLIDER_FALLBACK_MESSAGES[reason]);
    expect(messages.every((message) => message.trim() !== '')).toBe(true);
    expect(new Set(messages).size).toBe(reasons.length);
  });

  it('체크박스 묶음은 슬라이더를 고를 수 없어 방향 값이 남아 있어도 진단하지 않는다', () => {
    const rows = [scaleRow('r1', '회의실 지원')];
    expect(
      diagnoseChoiceGroupScaleSlider(groupInput(rows, [{ ...slider, type: 'checkbox' }])),
    ).toEqual({ issues: [], drawsNothing: false });
  });

  it('모든 행이 폴백이면 그릴 수 있는 행이 없다고 알린다 — 표 배치 판정과 같은 값이다', () => {
    const rows = [
      scaleRow('r1', '회의실 지원', (cell) => ({ ...cell, allowTextInput: true })),
      scaleRow('r2', '교통비 지원', (cell) => ({ ...cell, allowTextInput: true })),
    ];
    const diagnosis = diagnoseChoiceGroupScaleSlider(groupInput(rows));
    expect(diagnosis.drawsNothing).toBe(true);
    expect(diagnosis.issues[0]!.rowLabels).toEqual(['회의실 지원', '교통비 지원']);
    expect(
      tableHasScaleSliderRow({ columns, rows, choiceGroups: [slider], ungroupedSelectionType: null }),
    ).toBe(false);
  });

  it('이 묶음은 전부 폴백이어도 다른 묶음이 그려지면 화면은 바뀐다', () => {
    const other: ChoiceGroup = { ...slider, id: 'g-imp', groupKey: 'rad2', label: '중요도' };
    const rows = [
      scaleRow('r1', '회의실 지원', (cell) => ({ ...cell, allowTextInput: true })),
      scaleRow('r2', '교통비 지원', (cell) => cell, 'g-imp'),
    ];
    const diagnosis = diagnoseChoiceGroupScaleSlider(groupInput(rows, [slider, other]));
    expect(diagnosis.issues.map((issue) => issue.rowLabels)).toEqual([['회의실 지원']]);
    expect(diagnosis.drawsNothing).toBe(false);
  });

  it('다른 묶음의 폴백은 이 묶음의 문제로 세지 않는다', () => {
    const other: ChoiceGroup = { ...slider, id: 'g-imp', groupKey: 'rad2', label: '중요도' };
    const rows = [
      scaleRow('r1', '회의실 지원'),
      scaleRow('r2', '교통비 지원', (cell) => ({ ...cell, allowTextInput: true }), 'g-imp'),
    ];
    expect(diagnoseChoiceGroupScaleSlider(groupInput(rows, [slider, other])).issues).toEqual([]);
  });

  it('슬라이더를 고르지 않은 묶음은 진단하지 않는다', () => {
    const { scaleSlider: _direction, ...tiles } = slider;
    const rows = [scaleRow('r1', '회의실 지원', (cell) => ({ ...cell, allowTextInput: true }))];
    expect(diagnoseChoiceGroupScaleSlider(groupInput(rows, [tiles]))).toEqual({
      issues: [],
      drawsNothing: false,
    });
  });

  it('행 이름이 없으면 첫 글자 칸, 그것도 없으면 행 번호', () => {
    const bare: TableRow = {
      id: 'r2',
      label: '',
      cells: [
        { id: 'r2-item', type: 'text', content: '' },
        ...MARKS.map((_, n) => choice(`r2-c${n}`, '')),
      ],
    };
    const rows = [
      {
        ...scaleRow('r1', '회의실 지원', (cell) => ({ ...cell, allowTextInput: true })),
        label: '',
      },
      bare,
    ];
    const labels = diagnoseChoiceGroupScaleSlider(groupInput(rows)).issues.flatMap(
      (issue) => issue.rowLabels,
    );
    expect(labels).toEqual(['회의실 지원', '2행']);
  });

  it('헤더에서 칸 글자를 읽는 표는 헤더를 넘겨야 그려진다 — 응답 화면과 같은 재료를 쓴다', () => {
    const headerGrid: HeaderCell[][] = [
      [
        { id: 'h0', label: '항목', colspan: 1, rowspan: 1 },
        ...MARKS.map((label, n) => ({ id: `h${n + 1}`, label, colspan: 1, rowspan: 1 })),
      ],
    ];
    const rows = [scaleRow('r1', '회의실 지원', (cell) => ({ ...cell, content: '' }))];
    expect(diagnoseChoiceGroupScaleSlider(groupInput(rows)).issues).toHaveLength(1);
    expect(diagnoseChoiceGroupScaleSlider({ ...groupInput(rows), headerGrid }).issues).toEqual([]);
  });
});

describe('diagnoseTableScaleSliders — 표의 슬라이더 묶음 전부', () => {
  it('묶음 없는 묶음의 선택 방식이 복수 선택이면 그 이유를 낸다 — 투영과 같은 이유다', () => {
    const row = scaleRow('r1', '이용 경험', (cell) => cell, undefined);
    const input = {
      columns,
      rows: [row],
      choiceGroups: [],
      ungroupedSelectionType: 'checkbox' as const,
      ungroupedSliderDirection: 'positive-right' as const,
    };
    const projected = projectRowScaleSliders({ ...input, barHeaderGrid: undefined, row });
    expect(projected.fallbacks.map((fallback) => fallback.reason)).toEqual(['not-single-choice']);
    expect(diagnoseTableScaleSliders(input)).toEqual({
      issues: [
        {
          reason: 'not-single-choice',
          message: SCALE_SLIDER_FALLBACK_MESSAGES['not-single-choice'],
          rowLabels: ['이용 경험'],
        },
      ],
      sliderRowCount: 0,
    });
  });

  it('여러 묶음의 폴백을 이유별로 한데 모으고, 슬라이더가 서는 행을 센다', () => {
    const other: ChoiceGroup = { ...slider, id: 'g-imp', groupKey: 'rad2', label: '중요도' };
    const rows = [
      scaleRow('r1', '회의실 지원'),
      scaleRow('r2', '교통비 지원', (cell) => ({ ...cell, allowTextInput: true })),
      scaleRow('r3', '멘토링', (cell) => ({ ...cell, allowTextInput: true }), 'g-imp'),
      scaleRow('r4', '네트워킹', (cell) => cell, 'g-imp'),
    ];
    const diagnosis = diagnoseTableScaleSliders({
      columns,
      rows,
      choiceGroups: [slider, other],
      ungroupedSelectionType: null,
    });
    expect(diagnosis.issues).toEqual([
      {
        reason: 'text-input',
        message: SCALE_SLIDER_FALLBACK_MESSAGES['text-input'],
        rowLabels: ['교통비 지원', '멘토링'],
      },
    ]);
    expect(diagnosis.sliderRowCount).toBe(2);
  });
});

describe('summarizeTableScaleSlider — 표에 슬라이더가 켜져 있는가, 그려지는 행이 있는가', () => {
  const table = (rows: TableRow[], groups: ChoiceGroup[]) => ({
    rows,
    columns,
    choiceGroups: groups,
    ungroupedSelectionType: null,
  });

  it('슬라이더 설정이 없는 표는 꺼진 것이다', () => {
    const { scaleSlider: _direction, ...tiles } = slider;
    expect(summarizeTableScaleSlider(table([scaleRow('r1', '회의실 지원')], [tiles]))).toEqual({
      enabled: false,
      hasSliderRow: false,
    });
  });

  it('슬라이더 묶음이 그려지면 켜져 있고 그려지는 행이 있다', () => {
    expect(summarizeTableScaleSlider(table([scaleRow('r1', '회의실 지원')], [slider]))).toEqual({
      enabled: true,
      hasSliderRow: true,
    });
  });

  it('설정은 있는데 모든 행이 폴백이면 켜져 있지만 그려지는 행이 없다', () => {
    const rows = [scaleRow('r1', '회의실 지원', (cell) => ({ ...cell, allowTextInput: true }))];
    expect(summarizeTableScaleSlider(table(rows, [slider]))).toEqual({
      enabled: true,
      hasSliderRow: false,
    });
  });

  it('체크박스 묶음에 남은 방향 값은 켜진 것으로 보지 않는다', () => {
    expect(
      summarizeTableScaleSlider(
        table([scaleRow('r1', '회의실 지원')], [{ ...slider, type: 'checkbox' }]),
      ),
    ).toEqual({ enabled: false, hasSliderRow: false });
  });

  it('묶음 없는 보기 소스 표는 문항 설정의 방향으로 켜진다', () => {
    const rows = [scaleRow('r1', '추천 의향', (cell) => cell, undefined)];
    const base = { rows, columns, choiceGroups: [], ungroupedSelectionType: 'radio' as const };
    expect(summarizeTableScaleSlider(base)).toEqual({ enabled: false, hasSliderRow: false });
    expect(
      summarizeTableScaleSlider({ ...base, ungroupedSliderDirection: 'positive-left' }),
    ).toEqual({ enabled: true, hasSliderRow: true });
  });
});

const option = (n: number, extra: Partial<QuestionOption> = {}): QuestionOption => ({
  id: `o${n}`,
  label: `보기 ${n}`,
  value: String(n),
  ...extra,
});

const radioQuestion = (extra: Partial<Question> = {}): Question =>
  ({
    id: 'q1',
    type: 'radio',
    title: '추천 의향',
    required: false,
    order: 1,
    options: [1, 2, 3, 4, 5].map((n) => option(n)),
    scaleSlider: 'positive-right',
    ...extra,
  }) as Question;

const NO_ISSUE = {
  issues: [],
  drawsNothing: false,
  crampedNarrowTiles: false,
  sharedAnswerRows: false,
};

describe('diagnoseQuestionScaleSlider — 보통 라디오 문항', () => {
  it('슬라이더로 그려지는 문항은 문제가 없다', () => {
    expect(diagnoseQuestionScaleSlider(radioQuestion())).toEqual({
      target: 'radio-options',
      ...NO_ISSUE,
    });
  });

  it('꺼진 문항(키 없음 · 빌더가 끈 null)은 대상이 아니다', () => {
    const { scaleSlider: _direction, ...off } = radioQuestion();
    expect(diagnoseQuestionScaleSlider(off as Question).target).toBeNull();
    expect(diagnoseQuestionScaleSlider(radioQuestion({ scaleSlider: null })).target).toBeNull();
  });

  it('라디오가 아닌 문항은 방향 값이 실려 와도 대상이 아니다', () => {
    expect(diagnoseQuestionScaleSlider(radioQuestion({ type: 'checkbox' }))).toEqual({
      target: null,
      ...NO_ISSUE,
    });
  });

  it('상세 기재가 붙은 보기가 있으면 그 이유를 알리고 화면이 바뀌지 않는다고 한다', () => {
    const question = radioQuestion({
      options: [option(1), option(2), option(3, { allowTextInput: true })],
    });
    expect(diagnoseQuestionScaleSlider(question)).toEqual({
      target: 'radio-options',
      issues: [
        {
          reason: 'text-input',
          message: RADIO_OPTION_SLIDER_FALLBACK_MESSAGES['text-input'],
          rowLabels: [],
        },
      ],
      drawsNothing: true,
      crampedNarrowTiles: false,
      sharedAnswerRows: false,
    });
  });

  it('눈금 수가 범위 밖이면 그 이유를 알린다 — 「평균에서 제외」 보기는 눈금으로 세지 않는다', () => {
    const tooFew = radioQuestion({
      options: [option(1), option(9, { excludeFromMean: true })],
    });
    const tooMany = radioQuestion({
      options: Array.from({ length: 14 }, (_, n) => option(n + 1)),
    });
    for (const question of [tooFew, tooMany]) {
      const diagnosis = diagnoseQuestionScaleSlider(question);
      expect(diagnosis.issues.map((issue) => issue.reason)).toEqual(['cell-count']);
      expect(diagnosis.issues[0]!.message).toBe(RADIO_OPTION_SLIDER_FALLBACK_MESSAGES['cell-count']);
      expect(diagnosis.drawsNothing).toBe(true);
    }
  });

  it('라벨이 빈 보기가 있으면 그 이유를 알린다', () => {
    const diagnosis = diagnoseQuestionScaleSlider(
      radioQuestion({ options: [option(1), option(2, { label: '  ' })] }),
    );
    expect(diagnosis.issues.map((issue) => issue.reason)).toEqual(['missing-text']);
    expect(diagnosis.issues[0]!.message).toBe(RADIO_OPTION_SLIDER_FALLBACK_MESSAGES['missing-text']);
  });

  it('눈금이 8개 이상이면 좁은 화면에서 타일 글자가 끊긴다고 알린다 — 척도 밖 보기는 세지 않는다', () => {
    expect(RADIO_SLIDER_CRAMPED_TILE_MIN_TICKS).toBe(8);
    const seven = radioQuestion({
      options: [
        ...Array.from({ length: 7 }, (_, n) => option(n + 1)),
        option(99, { excludeFromMean: true }),
      ],
    });
    const eight = radioQuestion({ options: Array.from({ length: 8 }, (_, n) => option(n + 1)) });
    expect(diagnoseQuestionScaleSlider(seven).crampedNarrowTiles).toBe(false);
    expect(diagnoseQuestionScaleSlider(eight).crampedNarrowTiles).toBe(true);
  });

  it('슬라이더로 그릴 수 없는 문항에는 타일 글자 안내를 내지 않는다 — 타일이 그려지지 않는다', () => {
    const question = radioQuestion({
      options: [
        ...Array.from({ length: 8 }, (_, n) => option(n + 1)),
        option(99, { allowTextInput: true }),
      ],
    });
    const diagnosis = diagnoseQuestionScaleSlider(question);
    expect(diagnosis.drawsNothing).toBe(true);
    expect(diagnosis.crampedNarrowTiles).toBe(false);
  });
});

describe('diagnoseQuestionScaleSlider — 묶음 없는 보기 소스 표', () => {
  const tableQuestion = (rows: TableRow[], extra: Partial<Question> = {}): Question =>
    radioQuestion({ options: [], tableColumns: columns, tableRowsData: rows, ...extra });
  const ungrouped = (id: string, label: string, edit?: (cell: TableCell, n: number) => TableCell) =>
    scaleRow(id, label, edit, undefined);

  it('한 행짜리 척도 표가 그려지면 문제가 없다', () => {
    expect(diagnoseQuestionScaleSlider(tableQuestion([ungrouped('r1', '추천 의향')]))).toEqual({
      target: 'choice-table',
      ...NO_ISSUE,
    });
  });

  it('못 그리는 행을 이유와 행 이름으로 알린다 — 표의 문구를 쓴다', () => {
    const rows = [
      ungrouped('r1', '추천 의향'),
      ungrouped('r2', '재이용 의향', (cell, n) =>
        n === 4 ? { ...cell, allowTextInput: true } : cell,
      ),
    ];
    const diagnosis = diagnoseQuestionScaleSlider(tableQuestion(rows));
    expect(diagnosis.issues).toEqual([
      {
        reason: 'text-input',
        message: SCALE_SLIDER_FALLBACK_MESSAGES['text-input'],
        rowLabels: ['재이용 의향'],
      },
    ]);
    expect(diagnosis.drawsNothing).toBe(false);
  });

  it('모든 행이 폴백이면 화면이 바뀌지 않는다고 알린다', () => {
    const rows = [ungrouped('r1', '추천 의향', (cell) => ({ ...cell, allowTextInput: true }))];
    expect(diagnoseQuestionScaleSlider(tableQuestion(rows)).drawsNothing).toBe(true);
  });

  it('슬라이더가 서는 행이 둘 이상이면 답이 문항에 하나임을 알린다', () => {
    const one = tableQuestion([ungrouped('r1', '추천 의향')]);
    const two = tableQuestion([ungrouped('r1', '추천 의향'), ungrouped('r2', '재이용 의향')]);
    expect(diagnoseQuestionScaleSlider(one).sharedAnswerRows).toBe(false);
    expect(diagnoseQuestionScaleSlider(two).sharedAnswerRows).toBe(true);
  });

  it('라디오 묶음이 생긴 표는 문항 설정을 읽지 않는다 — 값이 남아 있어도 진단하지 않는다', () => {
    const { scaleSlider: _direction, ...tiles } = slider;
    const rows = [scaleRow('r1', '추천 의향', (cell) => ({ ...cell, allowTextInput: true }))];
    expect(diagnoseQuestionScaleSlider(tableQuestion(rows, { choiceGroups: [tiles] }))).toEqual({
      target: null,
      ...NO_ISSUE,
    });
  });

  it('헤더 격자는 문항의 것을 읽는다 — 헤더에만 번호가 있는 표도 그려진다', () => {
    const headerGrid: HeaderCell[][] = [
      [
        { id: 'h0', label: '항목', colspan: 1, rowspan: 1 },
        ...MARKS.map((label, n) => ({ id: `h${n + 1}`, label, colspan: 1, rowspan: 1 })),
      ],
    ];
    const rows = [ungrouped('r1', '추천 의향', (cell) => ({ ...cell, content: '' }))];
    expect(diagnoseQuestionScaleSlider(tableQuestion(rows)).issues).toHaveLength(1);
    expect(
      diagnoseQuestionScaleSlider(tableQuestion(rows, { tableHeaderGrid: headerGrid })).issues,
    ).toEqual([]);
  });
});
