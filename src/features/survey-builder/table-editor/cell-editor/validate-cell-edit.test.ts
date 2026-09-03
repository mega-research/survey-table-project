import { describe, expect, it } from 'vitest';

import { validateCellEdit } from '@/features/survey-builder/table-editor/cell-editor/validate-cell-edit';
import type { Question, TableCell, TableRow } from '@/types/survey';

const CELL: TableCell = { id: 'c1', type: 'ranking_opt', content: '' };

function form(overrides: Record<string, unknown> = {}) {
  return {
    contentType: 'ranking_opt',
    rankingOptions: [],
    isOtherRankingCell: false,
    textContent: '',
    rankingLabel: '',
    imageUrl: '',
    videoUrl: '',
    ...overrides,
  } as never;
}

const OWN_QUESTION = { id: 'q1', type: 'table', title: '' } as Question;

const CTX = {
  cell: CELL,
  currentQuestionId: 'q1',
  questions: [] as Question[],
  ownQuestion: OWN_QUESTION,
  latestRows: undefined as TableRow[] | undefined,
};

function rowsWithChoiceOpts(ids: string[]): TableRow[] {
  return [
    {
      id: 'r1',
      cells: ids.map((id) => ({ id, type: 'choice_opt', content: id }) as TableCell),
    } as TableRow,
  ];
}

describe('validateCellEdit', () => {
  describe('설명 테이블의 마지막 보기 옵션 셀 타입 변경', () => {
    const choiceCell: TableCell = { id: 'c1', type: 'choice_opt', content: '' };
    const radioQuestion = { ...OWN_QUESTION, type: 'radio' } as Question;

    it('radio 질문의 마지막 choice_opt 셀을 다른 타입으로 바꾸면 거부한다', () => {
      const got = validateCellEdit(form({ contentType: 'text' }), {
        ...CTX,
        cell: choiceCell,
        ownQuestion: radioQuestion,
        latestRows: rowsWithChoiceOpts(['c1']),
      });
      expect(got).toContain('마지막');
    });

    it('checkbox 질문도 같은 규칙을 탄다', () => {
      const got = validateCellEdit(form({ contentType: 'input' }), {
        ...CTX,
        cell: choiceCell,
        ownQuestion: { ...OWN_QUESTION, type: 'checkbox' } as Question,
        latestRows: rowsWithChoiceOpts(['c1']),
      });
      expect(got).toContain('마지막');
    });

    it('다른 choice_opt 셀이 남아 있으면 허용한다', () => {
      const got = validateCellEdit(form({ contentType: 'text' }), {
        ...CTX,
        cell: choiceCell,
        ownQuestion: radioQuestion,
        latestRows: rowsWithChoiceOpts(['c1', 'c2']),
      });
      expect(got).toBeNull();
    });

    it('타입을 choice_opt 로 유지하면 허용한다', () => {
      const got = validateCellEdit(form({ contentType: 'choice_opt' }), {
        ...CTX,
        cell: choiceCell,
        ownQuestion: radioQuestion,
        latestRows: rowsWithChoiceOpts(['c1']),
      });
      expect(got).toBeNull();
    });

    it('설명 테이블이 아닌(table 타입) 질문에서는 관여하지 않는다', () => {
      const got = validateCellEdit(form({ contentType: 'text' }), {
        ...CTX,
        cell: choiceCell,
        latestRows: rowsWithChoiceOpts(['c1']),
      });
      expect(got).toBeNull();
    });
  });

  it('순위형 셀은 옵션이 없으면 거부한다', () => {
    expect(validateCellEdit(form({ contentType: 'ranking' }), CTX)).toContain('최소 1개');
  });

  it('순위형 셀은 옵션이 하나라도 있으면 통과한다', () => {
    const f = form({ contentType: 'ranking', rankingOptions: [{ id: 'o1' }] });
    expect(validateCellEdit(f, CTX)).toBeNull();
  });

  it('순위 옵션 소스 셀은 표시할 내용이 하나도 없으면 거부한다', () => {
    expect(validateCellEdit(form(), CTX)).toContain('하나 이상');
  });

  it('내용이 공백뿐이어도 거부한다 — trim 기준', () => {
    expect(validateCellEdit(form({ textContent: '   ' }), CTX)).toContain('하나 이상');
  });

  it('넷 중 하나만 있어도 통과한다', () => {
    for (const key of ['textContent', 'rankingLabel', 'imageUrl', 'videoUrl']) {
      expect(validateCellEdit(form({ [key]: '값' }), CTX)).toBeNull();
    }
  });

  it('기타 지정 셀은 내용이 비어도 통과한다 — 라벨이 자동 폴백되므로', () => {
    expect(validateCellEdit(form({ isOtherRankingCell: true }), CTX)).toBeNull();
  });

  it('같은 질문에 기타 셀이 이미 있으면 거부한다', () => {
    const questions = [
      {
        id: 'q1',
        tableRowsData: [{ id: 'r1', cells: [{ id: 'other', type: 'ranking_opt', isOtherRankingCell: true }] }],
      },
    ] as unknown as Question[];
    const got = validateCellEdit(form({ isOtherRankingCell: true }), { ...CTX, questions });
    expect(got).toContain('최대 1개');
  });

  it('그 기타 셀이 자기 자신이면 거부하지 않는다', () => {
    const questions = [
      {
        id: 'q1',
        tableRowsData: [{ id: 'r1', cells: [{ id: 'c1', type: 'ranking_opt', isOtherRankingCell: true }] }],
      },
    ] as unknown as Question[];
    expect(validateCellEdit(form({ isOtherRankingCell: true }), { ...CTX, questions })).toBeNull();
  });
});
