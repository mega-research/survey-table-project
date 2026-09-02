import { describe, it, expect } from 'vitest';

import { isQuestionAnswered } from '@/lib/survey/answer-validation';
import type { Question, QuestionType } from '@/types/survey';

// ── 최소 Question 빌더 ──
// isQuestionAnswered 가 참조하는 필드는 type / minSelections / requiresAcknowledgment 뿐.
// 나머지 필수 필드(id/title/required/order)는 형식만 채운다.
function q(type: QuestionType, overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type,
    title: '질문',
    required: false,
    order: 0,
    ...overrides,
  };
}

/**
 * 그룹별 선택 radio 질문 빌더.
 * rad1(cellA, cellB), rad2(cellC), 미소속 default(cellD)
 */
function groupedRadioQ(): Question {
  return {
    id: 'qg',
    type: 'radio',
    title: '그룹 라디오',
    required: true,
    order: 0,
    tableColumns: [{ id: 'c1', label: '열' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'cellA', type: 'choice_opt', content: '', choiceGroupId: 'grp1' },
          { id: 'cellB', type: 'choice_opt', content: '', choiceGroupId: 'grp1' },
          { id: 'cellC', type: 'choice_opt', content: '', choiceGroupId: 'grp2' },
          { id: 'cellD', type: 'choice_opt', content: '' },
        ],
      },
    ],
    choiceGroups: [
      { id: 'grp1', type: 'radio', groupKey: 'rad1', label: '그룹1' },
      { id: 'grp2', type: 'radio', groupKey: 'rad2', label: '그룹2' },
    ],
  } as unknown as Question;
}

/**
 * checkbox 그룹이 포함된 질문 빌더.
 * rad1(cellA) + cb1(cellE, cellF) — radio 질문에 checkbox 그룹 혼재
 */
function groupedWithCheckboxQ(): Question {
  return {
    id: 'qgcb',
    type: 'radio',
    title: '혼합 그룹',
    required: true,
    order: 0,
    tableColumns: [{ id: 'c1', label: '열' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'cellA', type: 'choice_opt', content: '', choiceGroupId: 'grp1' },
          { id: 'cellE', type: 'choice_opt', content: '', choiceGroupId: 'grpCb' },
          { id: 'cellF', type: 'choice_opt', content: '', choiceGroupId: 'grpCb' },
        ],
      },
    ],
    choiceGroups: [
      { id: 'grp1', type: 'radio', groupKey: 'rad1', label: 'Radio그룹' },
      { id: 'grpCb', type: 'checkbox', groupKey: 'cb1', label: 'CB그룹' },
    ],
  } as unknown as Question;
}

describe('isQuestionAnswered (survey-response-flow 추출 characterization)', () => {
  // 모든 타입 공통: null/undefined 응답은 미응답.
  it('응답값이 undefined/null 이면 모든 타입에서 미응답', () => {
    const types: QuestionType[] = [
      'text',
      'textarea',
      'radio',
      'checkbox',
      'select',
      'multiselect',
      'ranking',
      'table',
      'notice',
    ];
    for (const t of types) {
      expect(isQuestionAnswered(q(t), undefined)).toBe(false);
      expect(isQuestionAnswered(q(t), null)).toBe(false);
    }
  });

  describe('text', () => {
    it('공백 아닌 문자열은 응답', () => {
      expect(isQuestionAnswered(q('text'), 'hello')).toBe(true);
    });
    it('빈 문자열/공백만은 미응답', () => {
      expect(isQuestionAnswered(q('text'), '')).toBe(false);
      expect(isQuestionAnswered(q('text'), '   ')).toBe(false);
    });
    it('문자열이 아니면 미응답', () => {
      expect(isQuestionAnswered(q('text'), 123)).toBe(false);
    });
  });

  describe('textarea', () => {
    it('공백 아닌 문자열은 응답', () => {
      expect(isQuestionAnswered(q('textarea'), '내용')).toBe(true);
    });
    it('공백만은 미응답', () => {
      expect(isQuestionAnswered(q('textarea'), ' \n\t ')).toBe(false);
    });
  });

  describe('radio', () => {
    it('빈 문자열이 아닌 값은 응답', () => {
      expect(isQuestionAnswered(q('radio'), 'opt1')).toBe(true);
      expect(isQuestionAnswered(q('radio'), '0')).toBe(true);
    });
    it('빈 문자열은 미응답', () => {
      expect(isQuestionAnswered(q('radio'), '')).toBe(false);
    });
  });

  describe('select', () => {
    it('빈 문자열이 아닌 값은 응답', () => {
      expect(isQuestionAnswered(q('select'), 'a')).toBe(true);
    });
    it('빈 문자열은 미응답', () => {
      expect(isQuestionAnswered(q('select'), '')).toBe(false);
    });
  });

  describe('checkbox', () => {
    it('비어있지 않은 배열은 응답 (minSelections 미설정)', () => {
      expect(isQuestionAnswered(q('checkbox'), ['a'])).toBe(true);
    });
    it('빈 배열/배열 아님은 미응답', () => {
      expect(isQuestionAnswered(q('checkbox'), [])).toBe(false);
      expect(isQuestionAnswered(q('checkbox'), 'a')).toBe(false);
    });
    it('minSelections 양수면 길이가 그 이상이어야 응답', () => {
      const cb = q('checkbox', { minSelections: 2 });
      expect(isQuestionAnswered(cb, ['a'])).toBe(false);
      expect(isQuestionAnswered(cb, ['a', 'b'])).toBe(true);
      expect(isQuestionAnswered(cb, ['a', 'b', 'c'])).toBe(true);
    });
    it('minSelections=0 이면 비어있지 않은 배열로 충족', () => {
      const cb = q('checkbox', { minSelections: 0 });
      expect(isQuestionAnswered(cb, ['a'])).toBe(true);
    });
  });

  describe('multiselect', () => {
    it('비어있지 않은 배열은 응답', () => {
      expect(isQuestionAnswered(q('multiselect'), ['x', 'y'])).toBe(true);
    });
    it('빈 배열/배열 아님은 미응답', () => {
      expect(isQuestionAnswered(q('multiselect'), [])).toBe(false);
      expect(isQuestionAnswered(q('multiselect'), 'x')).toBe(false);
    });
  });

  describe('ranking (default 분기)', () => {
    it('null/undefined 가 아닌 어떤 값이든 응답으로 취급', () => {
      expect(isQuestionAnswered(q('ranking'), [{ rank: 1, optionValue: 'a' }])).toBe(true);
      expect(isQuestionAnswered(q('ranking'), [])).toBe(true);
      expect(isQuestionAnswered(q('ranking'), {})).toBe(true);
    });
  });

  describe('table', () => {
    it('키가 하나 이상인 object 는 응답', () => {
      expect(isQuestionAnswered(q('table'), { cell1: 'v' })).toBe(true);
    });
    it('빈 object/배열은 미응답', () => {
      expect(isQuestionAnswered(q('table'), {})).toBe(false);
    });
    it('빈 배열은 키 0개라 미응답', () => {
      expect(isQuestionAnswered(q('table'), [])).toBe(false);
    });
    it('비어있지 않은 배열은 인덱스 키가 있어 응답으로 취급', () => {
      // 원본 로직: Object.keys(['v']).length === 1 > 0 → true
      expect(isQuestionAnswered(q('table'), ['v'])).toBe(true);
    });
  });

  describe('notice', () => {
    it('requiresAcknowledgment=false 면 null 이 아닌 값으로 항상 응답', () => {
      const n = q('notice', { requiresAcknowledgment: false });
      expect(isQuestionAnswered(n, true)).toBe(true);
      expect(isQuestionAnswered(n, false)).toBe(true);
      expect(isQuestionAnswered(n, {})).toBe(true);
    });
    it('requiresAcknowledgment 미설정도 false 취급이라 응답', () => {
      const n = q('notice');
      expect(isQuestionAnswered(n, false)).toBe(true);
    });
    it('requiresAcknowledgment=true + agreed 플래그 object 는 agreed 값을 따른다', () => {
      const n = q('notice', { requiresAcknowledgment: true });
      expect(isQuestionAnswered(n, { agreed: true })).toBe(true);
      expect(isQuestionAnswered(n, { agreed: false })).toBe(false);
    });
    it('requiresAcknowledgment=true + response===true 면 응답', () => {
      const n = q('notice', { requiresAcknowledgment: true });
      expect(isQuestionAnswered(n, true)).toBe(true);
    });
    it('requiresAcknowledgment=true + agreed 없는 object/false 면 미응답', () => {
      const n = q('notice', { requiresAcknowledgment: true });
      expect(isQuestionAnswered(n, {})).toBe(false);
      expect(isQuestionAnswered(n, false)).toBe(false);
    });
  });
});

describe('isQuestionAnswered — 그룹별 선택 radio (choiceGroups)', () => {
  it('모든 그룹(rad1, rad2, default)에 선택이 있어야 응답 충족', () => {
    const gq = groupedRadioQ();
    expect(
      isQuestionAnswered(gq, { rad1: 'cellA', rad2: 'cellC', default: 'cellD' }),
    ).toBe(true);
  });

  it('일부 그룹만 선택된 경우 미응답', () => {
    const gq = groupedRadioQ();
    // rad1만 선택, rad2/default 누락
    expect(isQuestionAnswered(gq, { rad1: 'cellA' })).toBe(false);
  });

  it('빈 맵({})은 미응답', () => {
    const gq = groupedRadioQ();
    expect(isQuestionAnswered(gq, {})).toBe(false);
  });

  it('undefined/null 은 미응답', () => {
    const gq = groupedRadioQ();
    expect(isQuestionAnswered(gq, undefined)).toBe(false);
    expect(isQuestionAnswered(gq, null)).toBe(false);
  });

  it('비그룹 radio 기존 동작 유지: 문자열이면 응답', () => {
    expect(isQuestionAnswered(q('radio'), 'opt1')).toBe(true);
    expect(isQuestionAnswered(q('radio'), '')).toBe(false);
  });

  it('phantom 그룹(멤버 0) 이 있어도 살아있는 그룹만 채우면 isQuestionAnswered=true', () => {
    // rad2 는 멤버가 없는 phantom — collectRadioGroups 가 제외하므로 요구 그룹이 줄어든다.
    const withPhantom: Question = {
      id: 'qp',
      type: 'radio',
      title: '팬텀 그룹 테스트',
      required: true,
      order: 0,
      tableColumns: [{ id: 'c1', label: '열' }],
      tableRowsData: [
        {
          id: 'r1',
          label: '',
          cells: [
            { id: 'cellA', type: 'choice_opt', content: '', choiceGroupId: 'grp1' },
            // grp2 에 소속된 셀 없음 — phantom
          ],
        },
      ],
      choiceGroups: [
        { id: 'grp1', type: 'radio', groupKey: 'rad1', label: '그룹1' },
        { id: 'grp2', type: 'radio', groupKey: 'rad2', label: '팬텀' },
      ],
    } as unknown as Question;
    // rad1 만 선택해도 살아있는 그룹은 rad1 뿐이므로 응답 충족
    expect(isQuestionAnswered(withPhantom, { rad1: 'cellA' })).toBe(true);
    // 아무것도 선택 안 하면 미응답
    expect(isQuestionAnswered(withPhantom, {})).toBe(false);
  });
});

// ── grouped 순위형 픽스처 ──
// rnk1 그룹(cellR1, cellR2), rnk2 그룹(cellR3), 미소속 ranking_opt 없음
function groupedRankingQ(): Question {
  return {
    id: 'qrnk',
    type: 'ranking',
    title: '그룹 순위형',
    required: true,
    order: 0,
    rankingConfig: { optionsSource: 'table' },
    tableColumns: [{ id: 'c1', label: '열' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'cellR1', type: 'ranking_opt', content: '항목1', choiceGroupId: 'rgrp1' },
          { id: 'cellR2', type: 'ranking_opt', content: '항목2', choiceGroupId: 'rgrp1' },
          { id: 'cellR3', type: 'ranking_opt', content: '항목3', choiceGroupId: 'rgrp2' },
        ],
      },
    ],
    choiceGroups: [
      { id: 'rgrp1', type: 'ranking', groupKey: 'rnk1', label: '그룹1' },
      { id: 'rgrp2', type: 'ranking', groupKey: 'rnk2', label: '그룹2' },
    ],
  } as unknown as Question;
}

/**
 * phantom-only ranking 픽스처:
 * choiceGroups 에 ranking 그룹(rgrp1)이 정의되어 있지만,
 * 어떤 ranking_opt 셀도 rgrp1 에 소속되지 않은 상태.
 * (manual → table 소스 전환 후 잔존하거나 snapshot 에 박힌 경우 재현)
 */
function phantomOnlyRankingQ(): Question {
  return {
    id: 'qrnk_phantom',
    type: 'ranking',
    title: 'phantom ranking 그룹 테스트',
    required: true,
    order: 0,
    rankingConfig: { optionsSource: 'table' },
    tableColumns: [{ id: 'c1', label: '열' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          // ranking_opt 셀이 아예 없거나, 있어도 rgrp1 에 소속되지 않음
          { id: 'cellText1', type: 'text', content: '안내' },
        ],
      },
    ],
    choiceGroups: [
      // ranking 그룹이 정의되어 있지만 멤버 셀이 0개 → phantom
      { id: 'rgrp1', type: 'ranking', groupKey: 'rnk1', label: '팬텀그룹' },
    ],
  } as unknown as Question;
}

describe('isQuestionAnswered — grouped 순위형 그룹당 1순위 검증', () => {
  it('두 그룹 모두 1개 이상 → 응답 충족', () => {
    const gq = groupedRankingQ();
    expect(
      isQuestionAnswered(gq, {
        rnk1: [{ rank: 1, optionValue: 'cellR1' }],
        rnk2: [{ rank: 1, optionValue: 'cellR3' }],
      }),
    ).toBe(true);
  });

  it('rnk2 키 없음 → 미응답', () => {
    const gq = groupedRankingQ();
    expect(
      isQuestionAnswered(gq, {
        rnk1: [{ rank: 1, optionValue: 'cellR1' }],
      }),
    ).toBe(false);
  });

  it('rnk2 빈 배열 → 미응답', () => {
    const gq = groupedRankingQ();
    expect(
      isQuestionAnswered(gq, {
        rnk1: [{ rank: 1, optionValue: 'cellR1' }],
        rnk2: [],
      }),
    ).toBe(false);
  });

  it('legacy flat 배열 응답(RankingAnswer[]) + grouped 질문 → 미응답(알려진 엣지)', () => {
    const gq = groupedRankingQ();
    // 이식 직후 진행중 응답이 flat 배열로 저장된 경우 — 맵이 아니므로 미충족 처리
    expect(
      isQuestionAnswered(gq, [
        { rank: 1, optionValue: 'cellR1' },
        { rank: 1, optionValue: 'cellR3' },
      ]),
    ).toBe(false);
  });

  it('undefined/null 은 상단 가드로 미응답', () => {
    const gq = groupedRankingQ();
    expect(isQuestionAnswered(gq, undefined)).toBe(false);
    expect(isQuestionAnswered(gq, null)).toBe(false);
  });

  it('비그룹 순위형: 빈 배열도 응답으로 취급(기존 동작 불변)', () => {
    expect(isQuestionAnswered(q('ranking'), [])).toBe(true);
  });

  it('비그룹 순위형: flat RankingAnswer[] 도 응답으로 취급(기존 동작 불변)', () => {
    expect(
      isQuestionAnswered(q('ranking'), [{ rank: 1, optionValue: 'a' }]),
    ).toBe(true);
  });

  it('phantom-only ranking 그룹(멤버 셀 0): flat 배열 응답 → 응답 충족(비그룹과 동일 취급)', () => {
    // collectRankingGroups 가 phantom 그룹을 skip 하여 groups.length === 0 이 됨.
    // 이때 flat 배열 응답이 하드블록되지 않고 true 를 반환해야 한다.
    const pq = phantomOnlyRankingQ();
    expect(
      isQuestionAnswered(pq, [{ rank: 1, optionValue: 'cellR1' }]),
    ).toBe(true);
  });

  it('phantom-only ranking 그룹(멤버 셀 0): 빈 배열 응답 → 응답 충족(비그룹 동일)', () => {
    const pq = phantomOnlyRankingQ();
    expect(isQuestionAnswered(pq, [])).toBe(true);
  });

  it('phantom-only ranking 그룹(멤버 셀 0): undefined → 상단 가드로 미응답', () => {
    const pq = phantomOnlyRankingQ();
    expect(isQuestionAnswered(pq, undefined)).toBe(false);
  });
});

describe('isQuestionAnswered — checkbox 그룹 검증', () => {
  it('cb1 에 1개 이상 선택 + rad1 선택 → 응답 충족', () => {
    const gq = groupedWithCheckboxQ();
    expect(isQuestionAnswered(gq, { rad1: 'cellA', cb1: ['cellE'] })).toBe(true);
    expect(isQuestionAnswered(gq, { rad1: 'cellA', cb1: ['cellE', 'cellF'] })).toBe(true);
  });

  it('cb1 키 없음 → 미응답', () => {
    const gq = groupedWithCheckboxQ();
    // rad1만 있고 cb1 없음
    expect(isQuestionAnswered(gq, { rad1: 'cellA' })).toBe(false);
  });

  it('cb1 빈 배열 → 미응답', () => {
    const gq = groupedWithCheckboxQ();
    expect(isQuestionAnswered(gq, { rad1: 'cellA', cb1: [] })).toBe(false);
  });

  it('cb1 값이 배열이 아닌 경우(잘못된 형태) → 미응답', () => {
    const gq = groupedWithCheckboxQ();
    // cb1 에 string이 들어간 잘못된 응답 — 배열이어야 충족
    expect(isQuestionAnswered(gq, { rad1: 'cellA', cb1: 'cellE' })).toBe(false);
  });

  it('radio 그룹 검증 기존 동작 유지: rad1 없으면 미응답', () => {
    const gq = groupedWithCheckboxQ();
    expect(isQuestionAnswered(gq, { cb1: ['cellE'] })).toBe(false);
  });
});

// ── 그룹별 필수(required)·문구(requiredMessage) 오버라이드 ──

import {
  hasExplicitRequiredChoiceGroup,
  resolveGroupedRequiredMessage,
} from '@/lib/survey/answer-validation';

function groupedWithOverrides(
  questionRequired: boolean,
  grp1: Partial<{ required: boolean; requiredMessage: string }>,
  grp2: Partial<{ required: boolean; requiredMessage: string }>,
): Question {
  // groupedRadioQ 와 달리 미소속 셀(default 그룹) 없이 rad1/rad2 두 그룹만 구성
  return {
    id: 'qov',
    type: 'radio',
    title: '그룹 필수 오버라이드',
    required: questionRequired,
    order: 0,
    tableColumns: [{ id: 'c1', label: '열' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'cellA', type: 'choice_opt', content: '', choiceGroupId: 'grp1' },
          { id: 'cellC', type: 'choice_opt', content: '', choiceGroupId: 'grp2' },
        ],
      },
    ],
    choiceGroups: [
      { id: 'grp1', type: 'radio', groupKey: 'rad1', label: '그룹1', ...grp1 },
      { id: 'grp2', type: 'radio', groupKey: 'rad2', label: '그룹2', ...grp2 },
    ],
  } as unknown as Question;
}

describe('그룹별 필수 오버라이드', () => {
  it('질문 필수 ON + 오버라이드 없음: 모든 그룹 충족 필요 (현행 유지)', () => {
    const gq = groupedWithOverrides(true, {}, {});
    expect(isQuestionAnswered(gq, { rad1: 'cellA' })).toBe(false);
    expect(isQuestionAnswered(gq, { rad1: 'cellA', rad2: 'cellC' })).toBe(true);
  });

  it('질문 필수 ON + grp1 개별 해제: rad2 만 충족하면 된다', () => {
    const gq = groupedWithOverrides(true, { required: false }, {});
    expect(isQuestionAnswered(gq, { rad2: 'cellC' })).toBe(true);
    expect(isQuestionAnswered(gq, { rad1: 'cellA' })).toBe(false);
  });

  it('질문 필수 OFF + grp2 개별 필수: rad2 만 충족하면 된다', () => {
    const gq = groupedWithOverrides(false, {}, { required: true });
    expect(isQuestionAnswered(gq, { rad2: 'cellC' })).toBe(true);
    expect(isQuestionAnswered(gq, { rad1: 'cellA' })).toBe(false);
  });

  it('질문 필수 OFF + 오버라이드 없음: 기존 동작 유지 (모든 그룹 기준)', () => {
    const gq = groupedWithOverrides(false, {}, {});
    expect(isQuestionAnswered(gq, { rad1: 'cellA' })).toBe(false);
    expect(isQuestionAnswered(gq, { rad1: 'cellA', rad2: 'cellC' })).toBe(true);
  });
});

describe('hasExplicitRequiredChoiceGroup', () => {
  it('그룹에 required:true 가 있으면 true, 없으면 false', () => {
    expect(hasExplicitRequiredChoiceGroup(groupedWithOverrides(false, {}, { required: true }))).toBe(true);
    expect(hasExplicitRequiredChoiceGroup(groupedWithOverrides(false, {}, {}))).toBe(false);
    expect(hasExplicitRequiredChoiceGroup(q('radio'))).toBe(false);
  });
});

describe('resolveGroupedRequiredMessage', () => {
  it('미충족 그룹의 문구를 우선 사용한다', () => {
    const gq = groupedWithOverrides(true, {}, { requiredMessage: '현재 상태를 선택해주세요.' });
    expect(resolveGroupedRequiredMessage(gq, { rad1: 'cellA' })).toBe('현재 상태를 선택해주세요.');
  });

  it('미충족 그룹에 문구가 없으면 질문 문구 → 기본 문구로 폴백한다', () => {
    const gq = groupedWithOverrides(true, {}, {});
    expect(resolveGroupedRequiredMessage({ ...gq, requiredMessage: '질문 문구' } as Question, { rad1: 'cellA' })).toBe('질문 문구');
    expect(resolveGroupedRequiredMessage(gq, { rad1: 'cellA' })).toBe('필수 질문에 답변해주세요.');
  });

  it('여러 그룹 미충족이면 정의 순서상 첫 미충족 그룹의 문구를 쓴다', () => {
    const gq = groupedWithOverrides(true, { requiredMessage: '12월 기준을 선택해주세요.' }, { requiredMessage: '현재 상태를 선택해주세요.' });
    expect(resolveGroupedRequiredMessage(gq, {})).toBe('12월 기준을 선택해주세요.');
  });

  it('비그룹 질문은 질문 문구로 폴백한다', () => {
    expect(resolveGroupedRequiredMessage(q('radio', { requiredMessage: '골라주세요.' }), null)).toBe('골라주세요.');
  });
});
