import { describe, expect, it } from 'vitest';

import { filterPriorAnswersByCondition } from '@/lib/survey/prior-answer-condition';
import {
  isPriorChoice,
  isPriorMultiSelectLevel,
  isPriorOptionTextValue,
  isPriorRanking,
  isPriorRankingText,
  isPriorText,
  matchesPriorChoice,
  selectHighlightablePriorAnswers,
} from '@/lib/survey/prior-answer-highlight';
import type { Question } from '@/types/survey';

function q(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    surveyId: 's1',
    type: 'text',
    title: id,
    required: false,
    order: 0,
    ...overrides,
  } as Question;
}

describe('selectHighlightablePriorAnswers', () => {
  it('이월 응답이 없으면 null', () => {
    expect(selectHighlightablePriorAnswers(null, [q('q1')])).toBeNull();
  });

  it('안내문과 본문 프리필 템플릿 문항을 걷어낸다', () => {
    const kept = selectHighlightablePriorAnswers({ q1: 'A', notice: 'B', tpl: 'C' }, [
      q('q1'),
      q('notice', { type: 'notice' }),
      q('tpl', { defaultValueTemplate: '{{회사명}}' }),
    ]);
    expect(kept).toEqual({ q1: 'A' });
  });

  it('걷어낸 문항의 상세기재 사이드카도 함께 뺀다', () => {
    const kept = selectHighlightablePriorAnswers(
      { q1: 'A', tpl: 'C', __optTexts__: { q1: { o1: '가' }, tpl: { o2: '나' } } },
      [q('q1'), q('tpl', { defaultValueTemplate: '{{회사명}}' })],
    );
    expect(kept).toEqual({ q1: 'A', __optTexts__: { q1: { o1: '가' } } });
  });

  it('문항 목록에 없는 키는 건드리지 않는다 — 구버전 응답의 잔여 키', () => {
    expect(selectHighlightablePriorAnswers({ gone: 'A' }, [q('q1')])).toEqual({ gone: 'A' });
  });

  it('조건으로 값이 걸러진 문항의 상세기재 사이드카도 함께 빠진다', () => {
    // 조건 필터는 사이드카를 통째로 통과시킨다(문항 id 가 아니라 예약 키라서).
    // 유형 축만 걸면 담당자가 막아 둔 문항의 상세기재 칸이 여전히 칠해진다.
    const conditioned = { q1: 'A', __optTexts__: { q1: { o1: '가' }, blocked: { o2: '나' } } };
    const kept = selectHighlightablePriorAnswers(conditioned, [q('q1'), q('blocked')]);
    expect(kept).toEqual({ q1: 'A', __optTexts__: { q1: { o1: '가' } } });
  });

  it('사이드카만 남은 문항은 칠하지 않는다 — 답이 없으면 상세기재도 떠 있을 자리가 없다', () => {
    const kept = selectHighlightablePriorAnswers(
      { __optTexts__: { q1: { o1: '가' } } },
      [q('q1')],
    );
    expect(kept).toEqual({});
  });
});

describe('이월값 조건과의 합류', () => {
  it('이월값 불러오기를 끈 문항은 표시 대상에서 빠진다', () => {
    // 담당자가 감춘 이월 값이 색으로 되살아나면 그 설정이 반쪽만 듣는 것이 된다.
    const questions = [q('q1'), q('off', { priorAnswerDisabled: true })];
    const conditioned = filterPriorAnswersByCondition({ q1: 'A', off: 'B' }, questions, {});
    const kept = selectHighlightablePriorAnswers(conditioned, questions);
    expect(kept).toEqual({ q1: 'A' });
    expect(isPriorChoice(kept, 'off', 'B')).toBe(false);
  });
});

describe('isPriorText', () => {
  const prior = { q1: '작년 답', tbl: { c1: '1000' } };

  it('글자 그대로 같을 때만 참', () => {
    expect(isPriorText(prior, 'q1', '작년 답')).toBe(true);
    expect(isPriorText(prior, 'q1', '작년 답 ')).toBe(false);
    expect(isPriorText(prior, 'q1', '올해 답')).toBe(false);
  });

  it('빈 값은 이월 값이 아니다', () => {
    expect(isPriorText({ q1: '' }, 'q1', '')).toBe(false);
  });

  it('표 셀은 셀 단위로 판정한다', () => {
    expect(isPriorText(prior, 'tbl', '1000', 'c1')).toBe(true);
    expect(isPriorText(prior, 'tbl', '2000', 'c1')).toBe(false);
    expect(isPriorText(prior, 'tbl', '1000', 'c2')).toBe(false);
  });

  it('이월 응답이 없으면 언제나 거짓', () => {
    expect(isPriorText(null, 'q1', '작년 답')).toBe(false);
  });
});

describe('isPriorChoice', () => {
  it('라디오·드롭다운은 문자열 하나와 비교한다', () => {
    expect(isPriorChoice({ q1: 'opt2' }, 'q1', 'opt2')).toBe(true);
    expect(isPriorChoice({ q1: 'opt2' }, 'q1', 'opt3')).toBe(false);
  });

  it('체크박스는 항목 단위다 — 작년 체크와 새 체크가 한 문항에 섞인다', () => {
    const prior = { q1: ['a', 'c'] };
    expect(isPriorChoice(prior, 'q1', 'a')).toBe(true);
    expect(isPriorChoice(prior, 'q1', 'c')).toBe(true);
    expect(isPriorChoice(prior, 'q1', 'b')).toBe(false);
  });

  it('레거시 기타 보기 객체의 selectedValue 를 읽는다', () => {
    expect(isPriorChoice({ q1: { selectedValue: 'other-option' } }, 'q1', 'other-option')).toBe(
      true,
    );
  });

  it('표 셀은 셀 주소로 찾는다', () => {
    const prior = { tbl: { c1: 'y', c2: ['a'] } };
    expect(isPriorChoice(prior, 'tbl', 'y', 'c1')).toBe(true);
    expect(isPriorChoice(prior, 'tbl', 'a', 'c2')).toBe(true);
    expect(isPriorChoice(prior, 'tbl', 'y', 'c2')).toBe(false);
  });

  it('빈 보기 키는 칠하지 않는다 — 미선택 드롭다운', () => {
    expect(isPriorChoice({ q1: '' }, 'q1', '')).toBe(false);
  });
});

describe('matchesPriorChoice', () => {
  it('조각을 직접 받아 판정한다 — 보기-소스 표의 사이드카 경로', () => {
    expect(matchesPriorChoice('y', 'y')).toBe(true);
    expect(matchesPriorChoice(['a', 'b'], 'b')).toBe(true);
    expect(matchesPriorChoice([], 'b')).toBe(false);
    expect(matchesPriorChoice(undefined, 'b')).toBe(false);
  });
});

describe('isPriorMultiSelectLevel', () => {
  const prior = { q1: ['서울', '강남구'] };

  it('단계 인덱스로 판정한다', () => {
    expect(isPriorMultiSelectLevel(prior, 'q1', 0, '서울')).toBe(true);
    expect(isPriorMultiSelectLevel(prior, 'q1', 1, '강남구')).toBe(true);
    expect(isPriorMultiSelectLevel(prior, 'q1', 1, '서초구')).toBe(false);
    expect(isPriorMultiSelectLevel(prior, 'q1', 0, '강남구')).toBe(false);
  });
});

describe('isPriorRanking', () => {
  const prior = {
    q1: [
      { rank: 1, optionValue: 'a' },
      { rank: 2, optionValue: 'b' },
    ],
    tbl: { g1: [{ rank: 1, optionValue: 'x' }] },
  };

  it('순위 칸 하나가 판정 단위다', () => {
    expect(isPriorRanking(prior, 'q1', 1, 'a')).toBe(true);
    expect(isPriorRanking(prior, 'q1', 2, 'b')).toBe(true);
    // 같은 보기를 다른 순위에 옮겼으면 그 칸은 작년과 다르다
    expect(isPriorRanking(prior, 'q1', 2, 'a')).toBe(false);
  });

  it('그룹·셀 순위형은 조각 주소로 찾는다', () => {
    expect(isPriorRanking(prior, 'tbl', 1, 'x', 'g1')).toBe(true);
    expect(isPriorRanking(prior, 'tbl', 1, 'x')).toBe(false);
  });

  it('형태가 깨진 이월 값은 조용히 거짓', () => {
    expect(isPriorRanking({ q1: 'not-an-array' }, 'q1', 1, 'a')).toBe(false);
    expect(isPriorRanking({ q1: [{ rank: '1', optionValue: 'a' }] }, 'q1', 1, 'a')).toBe(false);
  });
});

describe('isPriorRankingText', () => {
  const prior = {
    q1: [
      { rank: 1, optionValue: 'a', optionText: '작년 상세' },
      { rank: 2, optionValue: '__other__', otherText: '작년 기타' },
    ],
  };

  it('순위·필드 단위로 판정한다 — 보기는 그대로 두고 글만 고친 경우', () => {
    expect(isPriorRankingText(prior, 'q1', 1, 'optionText', '작년 상세')).toBe(true);
    expect(isPriorRankingText(prior, 'q1', 1, 'optionText', '올해 상세')).toBe(false);
    expect(isPriorRankingText(prior, 'q1', 2, 'otherText', '작년 기타')).toBe(true);
    // 필드가 다르면 짝이 아니다
    expect(isPriorRankingText(prior, 'q1', 1, 'otherText', '작년 상세')).toBe(false);
    // 순위가 다르면 짝이 아니다
    expect(isPriorRankingText(prior, 'q1', 2, 'optionText', '작년 상세')).toBe(false);
  });

  it('빈 값은 이월 값이 아니다', () => {
    expect(isPriorRankingText(prior, 'q1', 1, 'optionText', '')).toBe(false);
  });
});

describe('isPriorOptionTextValue', () => {
  const prior = { __optTexts__: { q1: { o1: '기타 내용' } } };

  it('보기 단위로 판정한다', () => {
    expect(isPriorOptionTextValue(prior, 'q1', 'o1', '기타 내용')).toBe(true);
    expect(isPriorOptionTextValue(prior, 'q1', 'o1', '고친 내용')).toBe(false);
    expect(isPriorOptionTextValue(prior, 'q1', 'o2', '기타 내용')).toBe(false);
  });
});
