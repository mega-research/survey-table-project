import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeQuestion, normalizeQuestions } from '@/lib/question';

import { makeOption, makeQuestion } from '../../helpers/question-factory';

/**
 * 읽기 경계 정규화 characterization.
 *
 * 골든 픽스처는 2026-06-12 실DB survey_versions 95개 스냅샷의 jsonb 키셋 audit 에서
 * 관측된 세대별 형태를 합성 복제한 것이다 (실데이터 값은 사용하지 않음).
 * 관측된 사실: 모든 세대의 스냅샷 질문이 cross-type 키를 보유한다 — snapshot-builder
 * 가 유형 무관 전 필드를 기입해 왔기 때문. preserve 모드는 이를 무변형 통과시켜야
 * 하고(기존 'as unknown as Question' 단언과 거동 동일), strict 모드는 variant 밖
 * 키를 소거해야 한다.
 */

// 최고(最古) 세대 radio — groupId/noticeContent/placeholder/questionCode/hideColumnLabels 부재
const GEN_OLDEST_RADIO = {
  id: 'q-radio-old',
  type: 'radio',
  title: '성별',
  required: true,
  order: 1,
  allowOtherOption: false,
  displayCondition: { conditions: [], logicType: 'AND' },
  options: [{ id: 'opt-1', label: '남성', value: '1' }],
  requiresAcknowledgment: false,
  selectLevels: [],
  tableColumns: [],
  tableHeaderGrid: [],
  tableRowsData: [],
  tableValidationRules: [],
};

// 중간 세대 text — hideColumnLabels/questionCode 등장, dynamicRowConfigs 이전
const GEN_MID_TEXT = {
  id: 'q-text-mid',
  type: 'text',
  title: '이름',
  required: false,
  order: 2,
  groupId: 'grp-1',
  questionCode: 'Q2',
  placeholder: '홍길동',
  allowOtherOption: false,
  hideColumnLabels: false,
  noticeContent: '',
  displayCondition: { conditions: [], logicType: 'AND' },
  options: [],
  requiresAcknowledgment: false,
  selectLevels: [],
  tableColumns: [],
  tableHeaderGrid: [],
  tableRowsData: [],
  tableValidationRules: [],
};

// 최신 세대 checkbox — inputType/optionsColumns/rankingConfig/dynamicRowConfigs 까지 오염
const GEN_NEW_CHECKBOX = {
  id: 'q-checkbox-new',
  type: 'checkbox',
  title: '보유 매체',
  required: true,
  order: 3,
  groupId: 'grp-1',
  questionCode: 'Q3',
  allowOtherOption: true,
  optionsColumns: 2,
  inputType: 'text',
  placeholder: '',
  noticeContent: '',
  rankingConfig: { positions: 3 },
  dynamicRowConfigs: [],
  hideColumnLabels: false,
  displayCondition: { conditions: [], logicType: 'AND' },
  options: [{ id: 'opt-1', label: 'TV', value: '1' }],
  requiresAcknowledgment: false,
  selectLevels: [],
  tableColumns: [],
  tableHeaderGrid: [],
  tableRowsData: [],
  tableValidationRules: [],
};

// 최신 세대 table — tableTitle 보유 + rankingConfig/options 오염
const GEN_NEW_TABLE = {
  id: 'q-table-new',
  type: 'table',
  title: '가구 현황',
  required: true,
  order: 4,
  groupId: 'grp-2',
  questionCode: 'Q4',
  tableTitle: '가구별 보유 현황',
  tableColumns: [{ id: 'col-1', label: '항목' }],
  tableRowsData: [{ id: 'row-1', label: '행', cells: [{ id: 'c1', content: '', type: 'checkbox' }] }],
  tableHeaderGrid: [],
  tableValidationRules: [],
  dynamicRowConfigs: [],
  hideColumnLabels: false,
  allowOtherOption: false,
  rankingConfig: { positions: 3 },
  noticeContent: '',
  placeholder: '',
  displayCondition: { conditions: [], logicType: 'AND' },
  options: [],
  requiresAcknowledgment: false,
  selectLevels: [],
};

// notice 세대 — questionCode 부재 + options/tableColumns 오염
const GEN_NOTICE = {
  id: 'q-notice',
  type: 'notice',
  title: '안내',
  required: false,
  order: 5,
  groupId: 'grp-1',
  noticeContent: '<p>응답 전 안내사항</p>',
  requiresAcknowledgment: true,
  allowOtherOption: false,
  hideColumnLabels: false,
  rankingConfig: { positions: 3 },
  dynamicRowConfigs: [],
  placeholder: '',
  displayCondition: { conditions: [], logicType: 'AND' },
  options: [],
  selectLevels: [],
  tableColumns: [],
  tableHeaderGrid: [],
  tableRowsData: [],
  tableValidationRules: [],
};

// drizzle 행 세대 — 스냅샷(undefined-세계)과 달리 nullable 컬럼이 null 값으로 실리고
// 행 잉여 키(surveyId/createdAt/imageUrl 등)가 동승한다. export 2라우트가
// db.query 행을 normalizeQuestions 에 직결하는 실제 입력 형태의 합성 복제.
const GEN_DRIZZLE_ROW = {
  id: 'q-drizzle-row',
  surveyId: 'svy-1',
  groupId: null,
  type: 'radio',
  title: '거주 지역',
  description: null,
  required: true,
  order: 6,
  options: [{ id: 'opt-1', label: '서울', value: '1' }],
  selectLevels: null,
  tableTitle: null,
  tableColumns: null,
  tableRowsData: null,
  tableHeaderGrid: null,
  tableValidationRules: null,
  dynamicRowConfigs: null,
  rankingConfig: null,
  choiceGroups: null,
  allowOtherOption: false,
  optionsColumns: null,
  minSelections: null,
  maxSelections: null,
  noticeContent: null,
  requiresAcknowledgment: null,
  placeholder: null,
  defaultValueTemplate: null,
  inputType: null,
  emptyDefault: null,
  hideColumnLabels: null,
  displayCondition: null,
  questionCode: null,
  isCustomSpssVarName: null,
  exportLabel: null,
  spssVarType: null,
  spssMeasure: null,
  imageUrl: null,
  videoUrl: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const GOLDEN_FIXTURES = [
  GEN_OLDEST_RADIO,
  GEN_MID_TEXT,
  GEN_NEW_CHECKBOX,
  GEN_NEW_TABLE,
  GEN_NOTICE,
  GEN_DRIZZLE_ROW,
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeQuestion - preserve 모드 (기본)', () => {
  it('모든 세대 골든 픽스처를 동일 참조로 무변형 통과시킨다', () => {
    for (const fixture of GOLDEN_FIXTURES) {
      const snapshot = structuredClone(fixture);
      const result = normalizeQuestion(fixture);
      expect(result).toBe(fixture); // 참조 동일 — 복사/변형 일절 없음
      expect(fixture).toEqual(snapshot); // 입력 객체 자체도 비변이
    }
  });

  it('알 수 없는 type 도 throw 없이 통과시키고 관측 로그만 남긴다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unknown = { id: 'q-x', type: 'file-upload', title: '미래 유형', required: false, order: 1 };
    const result = normalizeQuestion(unknown);
    expect(result).toBe(unknown);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('형태가 아예 아닌 값도 throw 하지 않는다 (기존 단언과 거동 동일)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => normalizeQuestion(null)).not.toThrow();
    expect(() => normalizeQuestion('garbage')).not.toThrow();
    expect(() => normalizeQuestion({ id: 1, type: 42 })).not.toThrow();
  });

  it('정상 형태에서는 관측 로그를 남기지 않는다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    normalizeQuestions(GOLDEN_FIXTURES);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('normalizeQuestion - strict 모드 (strip 활성화 목적지)', () => {
  it('모든 세대 골든 픽스처를 거부 없이 수용한다', () => {
    for (const fixture of GOLDEN_FIXTURES) {
      expect(() => normalizeQuestion(fixture, 'strict')).not.toThrow();
    }
  });

  it('radio 픽스처에서 cross-type 키를 소거하고 자기 키는 값 그대로 보존한다', () => {
    const parsed = normalizeQuestion(GEN_OLDEST_RADIO, 'strict') as unknown as Record<string, unknown>;
    // 소거: radio variant 밖 키
    expect(parsed).not.toHaveProperty('requiresAcknowledgment');
    expect(parsed).not.toHaveProperty('selectLevels');
    expect(parsed).not.toHaveProperty('tableValidationRules');
    // 보존: 자기 키 (내장 테이블 capability 포함)
    expect(parsed['options']).toEqual(GEN_OLDEST_RADIO.options);
    expect(parsed['tableRowsData']).toEqual(GEN_OLDEST_RADIO.tableRowsData);
    expect(parsed['displayCondition']).toEqual(GEN_OLDEST_RADIO.displayCondition);
  });

  it('checkbox 픽스처에서 rankingConfig/inputType/noticeContent 오염을 소거한다', () => {
    const parsed = normalizeQuestion(GEN_NEW_CHECKBOX, 'strict') as unknown as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('rankingConfig');
    expect(parsed).not.toHaveProperty('inputType');
    expect(parsed).not.toHaveProperty('noticeContent');
    expect(parsed).not.toHaveProperty('placeholder');
    expect(parsed['optionsColumns']).toBe(2);
    expect(parsed['allowOtherOption']).toBe(true);
  });

  it('table 픽스처에서 options/rankingConfig 오염을 소거하고 테이블 필드를 보존한다', () => {
    const parsed = normalizeQuestion(GEN_NEW_TABLE, 'strict') as unknown as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('options');
    expect(parsed).not.toHaveProperty('rankingConfig');
    expect(parsed).not.toHaveProperty('allowOtherOption');
    expect(parsed['tableTitle']).toBe(GEN_NEW_TABLE.tableTitle);
    expect(parsed['tableValidationRules']).toEqual([]);
    expect(parsed['dynamicRowConfigs']).toEqual([]);
  });

  it('과거 table snapshot의 mobileOriginalTable 키를 strict 모드에서도 보존한다', () => {
    const parsed = normalizeQuestion(
      { ...GEN_NEW_TABLE, mobileOriginalTable: true },
      'strict',
    ) as unknown as Record<string, unknown>;
    expect(parsed['mobileOriginalTable']).toBe(true);
    expect(parsed['mobileTableDisplayMode']).toBeUndefined();
  });

  it('유효하지 않은 snapshot enum은 strict 모드에서 legacy fallback 가능한 형태로 수렴한다', () => {
    const parsed = normalizeQuestion(
      { ...GEN_NEW_TABLE, mobileTableDisplayMode: 'broken', mobileOriginalTable: true },
      'strict',
    ) as unknown as Record<string, unknown>;
    expect(parsed['mobileTableDisplayMode']).toBeUndefined();
    expect(parsed['mobileOriginalTable']).toBe(true);
  });

  it('notice 픽스처에서 테이블/옵션 오염을 소거하고 공지 필드를 보존한다', () => {
    const parsed = normalizeQuestion(GEN_NOTICE, 'strict') as unknown as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('tableColumns');
    expect(parsed).not.toHaveProperty('options');
    expect(parsed).not.toHaveProperty('hideColumnLabels');
    expect(parsed['noticeContent']).toBe(GEN_NOTICE.noticeContent);
    expect(parsed['requiresAcknowledgment']).toBe(true);
  });

  it('drizzle 행의 null 컬럼을 키 부재로 수렴하고 행 잉여 키를 소거한다', () => {
    const parsed = normalizeQuestion(GEN_DRIZZLE_ROW, 'strict') as unknown as Record<string, unknown>;
    // null 컬럼 → 키 부재 (undefined-세계 수렴) — variant 소유 키라도 null 이면 드랍
    expect(parsed).not.toHaveProperty('description');
    expect(parsed).not.toHaveProperty('groupId');
    expect(parsed).not.toHaveProperty('tableColumns');
    expect(parsed).not.toHaveProperty('choiceGroups');
    expect(parsed).not.toHaveProperty('spssVarType');
    expect(parsed).not.toHaveProperty('questionCode');
    // 행 잉여 키 strip (variant 밖 컬럼)
    expect(parsed).not.toHaveProperty('surveyId');
    expect(parsed).not.toHaveProperty('createdAt');
    expect(parsed).not.toHaveProperty('updatedAt');
    expect(parsed).not.toHaveProperty('imageUrl');
    // 실값 보존
    expect(parsed['options']).toEqual(GEN_DRIZZLE_ROW.options);
    expect(parsed['required']).toBe(true);
    expect(parsed['allowOtherOption']).toBe(false);
  });

  it('preserve 모드는 drizzle 행의 null 을 건드리지 않는다 (무변형 계약)', () => {
    const result = normalizeQuestion(GEN_DRIZZLE_ROW) as unknown as Record<string, unknown>;
    expect(result).toBe(GEN_DRIZZLE_ROW);
    expect(result['description']).toBeNull();
    expect(result['surveyId']).toBe('svy-1');
  });

  it('알 수 없는 type 은 거부한다 (preserve 와 의도적으로 다른 거동)', () => {
    expect(() =>
      normalizeQuestion({ id: 'q-x', type: 'file-upload', title: 't', required: false, order: 1 }, 'strict'),
    ).toThrow();
  });
});

describe('normalizeQuestion - strict 모드 잔여 4유형 특성화 (select/multiselect/ranking/textarea)', () => {
  it('select: 테이블/그룹/다단계 오염을 소거하고 options 만 보존한다 — optionsColumns 도 비소유', () => {
    const polluted = {
      ...makeQuestion.select(),
      optionsColumns: 2,
      selectLevels: [],
      tableRowsData: [],
      choiceGroups: [],
    };
    const parsed = normalizeQuestion(polluted, 'strict') as unknown as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('optionsColumns');
    expect(parsed).not.toHaveProperty('selectLevels');
    expect(parsed).not.toHaveProperty('tableRowsData');
    expect(parsed).not.toHaveProperty('choiceGroups');
    expect(parsed['options']).toEqual(polluted.options);
  });

  it('multiselect: options/allowOtherOption 오염을 소거하고 selectLevels 만 보존한다', () => {
    const polluted = {
      ...makeQuestion.multiselect(),
      options: [makeOption('opt-x', '오염 옵션')],
      allowOtherOption: true,
    };
    const parsed = normalizeQuestion(polluted, 'strict') as unknown as Record<string, unknown>;
    // 코드드 옵션 리스트는 selectLevels 내부 소유 — question.options 는 variant 밖
    expect(parsed).not.toHaveProperty('options');
    expect(parsed).not.toHaveProperty('allowOtherOption');
    expect(parsed['selectLevels']).toEqual(polluted.selectLevels);
  });

  it('ranking: 옵션 리스트 + 내장 테이블 + rankingConfig 를 보존하고 공지/단답 오염을 소거한다', () => {
    const polluted = {
      ...makeQuestion.ranking(),
      tableRowsData: [{ id: 'row-1', label: '행', cells: [] }],
      noticeContent: '',
      placeholder: '',
    };
    const parsed = normalizeQuestion(polluted, 'strict') as unknown as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('noticeContent');
    expect(parsed).not.toHaveProperty('placeholder');
    expect(parsed['options']).toEqual(polluted.options);
    expect(parsed['rankingConfig']).toEqual(polluted.rankingConfig);
    expect(parsed['tableRowsData']).toEqual(polluted.tableRowsData);
  });

  it('textarea: base 외 전부 소거되는 가장 얇은 variant 다', () => {
    const polluted = {
      ...makeQuestion.textarea(),
      placeholder: '장문 힌트',
      options: [],
      noticeContent: '',
      tableColumns: [],
    };
    const parsed = normalizeQuestion(polluted, 'strict') as unknown as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('placeholder');
    expect(parsed).not.toHaveProperty('options');
    expect(parsed).not.toHaveProperty('noticeContent');
    expect(parsed).not.toHaveProperty('tableColumns');
    expect(parsed['title']).toBe(polluted.title);
  });
});
