import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import { collectPreviewPriorSeeds } from './preview-prior-seeds';

/**
 * 빌더 미리보기의 이월 값 — 응답 화면과 같은 규칙으로 깐다(값이 있는 문항은 덮지 않고,
 * 「이월값 불러오기」를 끈 문항은 깔지 않는다). 기타·상세 기재는 따로 돌려 스토어에 시드한다.
 */
const questions = [
  { id: 'q1', type: 'text', title: '매출', required: false, order: 0 },
  { id: 'q2', type: 'text', title: '인원', required: false, order: 1, priorAnswerDisabled: true },
  { id: 'q3', type: 'radio', title: '업종', required: false, order: 2, options: [{ id: 'o1', label: '기타', value: '9', allowTextInput: true }] },
  { id: 'n1', type: 'notice', title: '안내', required: false, order: 3 },
] as unknown as Question[];

describe('collectPreviewPriorSeeds', () => {
  it('값이 없는 문항에만 이월 값을 깐다 — 끈 문항·답이 없는 유형은 뺀다', () => {
    const seeds = collectPreviewPriorSeeds({ q1: '1200', q2: '5', q3: '9', n1: 'x' }, questions, {});
    expect(seeds.entries).toEqual([
      { questionId: 'q1', value: '1200' },
      { questionId: 'q3', value: '9' },
    ]);
  });

  it('이미 값이 있는 문항은 덮지 않는다', () => {
    const seeds = collectPreviewPriorSeeds({ q1: '1200' }, questions, { q1: '999' });
    expect(seeds.entries).toEqual([]);
  });

  it('기타·상세 기재 사이드카를 따로 돌려준다', () => {
    const seeds = collectPreviewPriorSeeds({ q3: '9', __optTexts__: { q3: { o1: '공예' } } }, questions, {});
    expect(seeds.optionTexts).toEqual({ q3: { o1: '공예' } });
  });

  it('이월 응답이 없으면 빈 결과', () => {
    expect(collectPreviewPriorSeeds(null, questions, {})).toEqual({ entries: [], optionTexts: {} });
  });
});
