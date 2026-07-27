import { describe, expect, it } from 'vitest';

import { RANKING_OTHER_VALUE } from '@/utils/ranking-shared';
import {
  resolveRankingOptions,
  resolveRankingOptionsFromCells,
} from '@/utils/ranking-source';
import type { Question, TableCell } from '@/types/survey';

// ── 헬퍼 ──────────────────────────────────────────────────────────────

function makeCell(overrides: Partial<TableCell>): TableCell {
  return {
    id: 'cell-default',
    type: 'ranking_opt',
    ...overrides,
  } as TableCell;
}

function makeQuestion(overrides: Record<string, unknown>): Question {
  return {
    id: 'q1',
    type: 'ranking',
    title: '순위 질문',
    required: false,
    order: 1,
    ...overrides,
  } as unknown as Question;
}

// ── resolveRankingOptionsFromCells ─────────────────────────────────────

describe('resolveRankingOptionsFromCells', () => {
  it('코드 미지정 셀 2개: spssNumericCode 가 배열 내 1-based 순번(1, 2)이 된다', () => {
    const cells: TableCell[] = [
      makeCell({ id: 'c1', content: '옵션A' }),
      makeCell({ id: 'c2', content: '옵션B' }),
    ];
    const opts = resolveRankingOptionsFromCells(cells);

    expect(opts).toHaveLength(2);
    expect(opts[0]!.spssNumericCode).toBe(1);
    expect(opts[1]!.spssNumericCode).toBe(2);
  });

  it('셀에 spssNumericCode 가 명시된 경우 해당 값을 우선 사용한다', () => {
    const cells: TableCell[] = [
      makeCell({ id: 'c1', content: '옵션A', spssNumericCode: 10 }),
      makeCell({ id: 'c2', content: '옵션B', spssNumericCode: 20 }),
    ];
    const opts = resolveRankingOptionsFromCells(cells);

    expect(opts[0]!.spssNumericCode).toBe(10);
    expect(opts[1]!.spssNumericCode).toBe(20);
  });

  it('isOtherRankingCell=true 인 셀: value=RANKING_OTHER_VALUE, spssNumericCode 없음', () => {
    const cells: TableCell[] = [
      makeCell({ id: 'c-other', content: '기타', isOtherRankingCell: true }),
    ];
    const opts = resolveRankingOptionsFromCells(cells);

    expect(opts).toHaveLength(1);
    expect(opts[0]!.value).toBe(RANKING_OTHER_VALUE);
    expect('spssNumericCode' in opts[0]!).toBe(false);
  });

  it('일반 셀: value = cell.id', () => {
    const cells: TableCell[] = [makeCell({ id: 'c1', content: '옵션' })];
    const opts = resolveRankingOptionsFromCells(cells);

    expect(opts[0]!.value).toBe('c1');
    expect(opts[0]!.id).toBe('c1');
  });

  it('ranking_opt 스타일을 파생 QuestionOption에 전달한다', () => {
    const options = resolveRankingOptionsFromCells([
      makeCell({
        id: 'rank-cell',
        content: '항목',
        textBold: true,
        backgroundColor: '#AABBCC',
      }),
    ]);

    expect(options[0]).toMatchObject({ textBold: true, backgroundColor: '#AABBCC' });
  });

  it('기타 ranking_opt도 스타일을 파생 QuestionOption에 전달한다', () => {
    const options = resolveRankingOptionsFromCells([
      makeCell({
        id: 'other-rank-cell',
        content: '기타',
        isOtherRankingCell: true,
        textBold: true,
        backgroundColor: '#AABBCC',
      }),
    ]);

    expect(options[0]).toMatchObject({ textBold: true, backgroundColor: '#AABBCC' });
  });

  it.each([false, true])(
    'ranking_opt의 상세기입 메타데이터를 파생 옵션에 전달한다 isOther=%s',
    (isOtherRankingCell) => {
      const options = resolveRankingOptionsFromCells([
        makeCell({
          id: 'detail-rank-cell',
          content: '상세 옵션',
          isOtherRankingCell,
          allowTextInput: true,
          textInputPlaceholder: '선택 사유',
        }),
      ]);

      expect(options[0]).toMatchObject({
        allowTextInput: true,
        textInputPlaceholder: '선택 사유',
      });
    },
  );

  describe('라벨 우선순위: content > rankingLabel > "(라벨 없음)"', () => {
    it('content 가 있으면 content 사용', () => {
      const cells: TableCell[] = [makeCell({ id: 'c1', content: '내용라벨', rankingLabel: 'SPSS라벨' })];
      const opts = resolveRankingOptionsFromCells(cells);
      expect(opts[0]!.label).toBe('내용라벨');
    });

    it('content 없고 rankingLabel 있으면 rankingLabel 사용', () => {
      const cells: TableCell[] = [makeCell({ id: 'c1', content: '', rankingLabel: 'SPSS라벨' })];
      const opts = resolveRankingOptionsFromCells(cells);
      expect(opts[0]!.label).toBe('SPSS라벨');
    });

    it('둘 다 없으면 "(라벨 없음)" 폴백', () => {
      const cells: TableCell[] = [makeCell({ id: 'c1' })];
      const opts = resolveRankingOptionsFromCells(cells);
      expect(opts[0]!.label).toBe('(라벨 없음)');
    });

    it('기타 셀: content 없으면 "기타 (직접 입력)" 폴백', () => {
      const cells: TableCell[] = [makeCell({ id: 'c-other', isOtherRankingCell: true })];
      const opts = resolveRankingOptionsFromCells(cells);
      expect(opts[0]!.label).toBe('기타 (직접 입력)');
    });
  });

  it('빈 배열 입력 → 빈 배열 반환', () => {
    expect(resolveRankingOptionsFromCells([])).toEqual([]);
  });
});

// ── resolveRankingOptions 기존 계약 (불변 고정) ────────────────────────

describe('resolveRankingOptions 기존 계약', () => {
  it('manual 소스(optionsSource !== "table"): question.options 를 그대로 반환', () => {
    const manualOpts = [
      { id: 'o1', value: 'v1', label: '선택1', spssNumericCode: 1 },
      { id: 'o2', value: 'v2', label: '선택2', spssNumericCode: 2 },
    ];
    const question = makeQuestion({
      rankingConfig: { optionsSource: 'manual', count: 2 },
      options: manualOpts,
    });
    expect(resolveRankingOptions(question)).toBe(manualOpts);
  });

  it('manual 소스이고 options 가 undefined 이면 빈 배열 반환', () => {
    const question = makeQuestion({
      rankingConfig: { optionsSource: 'manual', count: 2 },
      options: undefined,
    });
    expect(resolveRankingOptions(question)).toEqual([]);
  });

  it('table 소스: 전체 ranking_opt 셀 순번 폴백 — 질문 전체 기준 1-based(동작 불변)', () => {
    const question = makeQuestion({
      rankingConfig: { optionsSource: 'table', count: 2 },
      tableRowsData: [
        {
          id: 'r1',
          label: '행1',
          cells: [
            { id: 'cell-a', type: 'ranking_opt', content: '선택A' },
            { id: 'cell-b', type: 'ranking_opt', content: '선택B' },
            { id: 'cell-txt', type: 'text', content: '텍스트' }, // 비ranking_opt, 무시
          ],
        },
      ],
    });
    const opts = resolveRankingOptions(question);

    expect(opts).toHaveLength(2);
    expect(opts[0]!.id).toBe('cell-a');
    expect(opts[0]!.spssNumericCode).toBe(1);
    expect(opts[1]!.id).toBe('cell-b');
    expect(opts[1]!.spssNumericCode).toBe(2);
  });

  it('table 소스: isHidden 셀은 제외된다', () => {
    const question = makeQuestion({
      rankingConfig: { optionsSource: 'table', count: 1 },
      tableRowsData: [
        {
          id: 'r1',
          label: '행1',
          cells: [
            { id: 'cell-hidden', type: 'ranking_opt', content: '숨김', isHidden: true },
            { id: 'cell-visible', type: 'ranking_opt', content: '보임' },
          ],
        },
      ],
    });
    const opts = resolveRankingOptions(question);

    expect(opts).toHaveLength(1);
    expect(opts[0]!.id).toBe('cell-visible');
  });
});
