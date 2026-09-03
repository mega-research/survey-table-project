import { describe, expect, it } from 'vitest';

import { validateCellEdit } from '@/features/survey-builder/table-editor/cell-editor/validate-cell-edit';
import type { Question, TableCell } from '@/types/survey';

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

const CTX = { cell: CELL, currentQuestionId: 'q1', questions: [] as Question[] };

describe('validateCellEdit', () => {
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
