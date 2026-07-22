import { describe, expect, it } from 'vitest';

import {
  CheckboxQuestionSchema,
  MultiselectQuestionSchema,
  NoticeQuestionSchema,
  QuestionVariantSchema,
  RadioQuestionSchema,
  RankingQuestionSchema,
  SelectQuestionSchema,
  TableQuestionSchema,
  TextQuestionSchema,
  TextareaQuestionSchema,
  assertNeverQuestionType,
  isCheckboxQuestion,
  isChoiceGroupCapableQuestion,
  isEmbeddedTableQuestion,
  isMultiselectQuestion,
  isNoticeQuestion,
  isOptionListQuestion,
  isRadioQuestion,
  isRankingQuestion,
  isSelectQuestion,
  isTableQuestion,
  isTextQuestion,
  isTextareaQuestion,
  toFlatQuestion,
} from '@/lib/question';
import type { QuestionVariant } from '@/lib/question';
import { MOBILE_TABLE_DISPLAY_TYPES, isMobileTableDisplayType } from '@/types/question-types';
import type { Question } from '@/types/survey';

import { makeAllQuestionVariants, makeQuestion } from '../../helpers/question-factory';

/**
 * 유형 × 필드 매트릭스 박제 — 2026-06-12 실측 탐색(8방향 + 적대 검증)으로 확정한
 * 필드 소유 구조를 테스트로 고정한다. 이 매트릭스가 바뀌는 변경은 의도된 도메인
 * 변경이어야 하며, 우연한 스키마 드리프트면 여기서 깨진다.
 */

const BASE_KEYS = [
  'id',
  'title',
  'description',
  'required',
  'groupId',
  'order',
  'displayCondition',
  'questionCode',
  'isCustomSpssVarName',
  'exportLabel',
  'spssVarType',
  'spssMeasure',
  'type',
];

const EMBEDDED_TABLE_KEYS = [
  'tableTitle',
  'tableColumns',
  'tableRowsData',
  'tableHeaderGrid',
  'hideColumnLabels',
];

const OPTION_LIST_KEYS = ['options', 'optionsColumns', 'optionsAlign', 'allowOtherOption'];

const MOBILE_TABLE_DISPLAY_KEYS = [
  'mobileOriginalTable',
  'mobileTableDisplayMode',
  'mobileDrilldownOmitLeadingColumns',
  'mobileDrilldownRepeatHeaderStartRow',
  'mobileDrilldownRepeatHeaderEndRow',
];

function shapeKeys(schema: { shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape).sort();
}

function sorted(keys: string[]): string[] {
  return [...keys].sort();
}

describe('유형별 필드 매트릭스 (실측 박제)', () => {
  it('text: base + 단답형 전용 4종', () => {
    expect(shapeKeys(TextQuestionSchema)).toEqual(
      sorted([...BASE_KEYS, 'placeholder', 'defaultValueTemplate', 'inputType', 'emptyDefault']),
    );
  });

  it('textarea: 전용 필드 0 — base 뿐인 가장 얇은 variant', () => {
    expect(shapeKeys(TextareaQuestionSchema)).toEqual(sorted(BASE_KEYS));
  });

  it('radio: base + 옵션 리스트 + 내장 테이블 + 모바일 표시 + choiceGroups', () => {
    expect(shapeKeys(RadioQuestionSchema)).toEqual(
      sorted([
        ...BASE_KEYS,
        ...OPTION_LIST_KEYS,
        ...EMBEDDED_TABLE_KEYS,
        ...MOBILE_TABLE_DISPLAY_KEYS,
        'choiceGroups',
      ]),
    );
  });

  it('checkbox: radio 구성 + min/maxSelections', () => {
    expect(shapeKeys(CheckboxQuestionSchema)).toEqual(
      sorted([
        ...BASE_KEYS,
        ...OPTION_LIST_KEYS,
        ...EMBEDDED_TABLE_KEYS,
        ...MOBILE_TABLE_DISPLAY_KEYS,
        'choiceGroups',
        'minSelections',
        'maxSelections',
      ]),
    );
  });

  it('select: options/allowOtherOption 만 — optionsColumns·테이블 capability 없음', () => {
    expect(shapeKeys(SelectQuestionSchema)).toEqual(
      sorted([...BASE_KEYS, 'options', 'allowOtherOption']),
    );
  });

  it('multiselect: selectLevels 전용', () => {
    expect(shapeKeys(MultiselectQuestionSchema)).toEqual(sorted([...BASE_KEYS, 'selectLevels']));
  });

  it('ranking: 옵션 리스트 + 내장 테이블 + choiceGroups + rankingConfig', () => {
    expect(shapeKeys(RankingQuestionSchema)).toEqual(
      sorted([
        ...BASE_KEYS,
        ...OPTION_LIST_KEYS,
        ...EMBEDDED_TABLE_KEYS,
        'choiceGroups',
        'rankingConfig',
      ]),
    );
  });

  it('table: 내장 테이블 + 모바일 표시 + 검증 규칙/동적 행 — choiceGroups·options 없음', () => {
    expect(shapeKeys(TableQuestionSchema)).toEqual(
      sorted([
        ...BASE_KEYS,
        ...EMBEDDED_TABLE_KEYS,
        ...MOBILE_TABLE_DISPLAY_KEYS,
        'tableValidationRules',
        'dynamicRowConfigs',
      ]),
    );
  });

  it('notice: noticeContent + requiresAcknowledgment', () => {
    expect(shapeKeys(NoticeQuestionSchema)).toEqual(
      sorted([...BASE_KEYS, 'noticeContent', 'requiresAcknowledgment']),
    );
  });
});

describe('팩토리 산출물 roundtrip', () => {
  it('자기 필드만 가진 입력은 strict parse 가 무변형이다', () => {
    for (const question of makeAllQuestionVariants()) {
      const parsed = QuestionVariantSchema.parse(question);
      expect(parsed, `${question.type} roundtrip`).toEqual(question);
    }
  });

  it('모든 variant 는 flat Question 에 캐스트 없이 할당 가능하다 (전환기 호환성 축)', () => {
    const flat: Question[] = makeAllQuestionVariants().map(toFlatQuestion);
    expect(flat).toHaveLength(9);
  });
});

describe('분류 가드', () => {
  it('모바일 테이블 표시 설정은 radio/checkbox/table 3유형만 registry로 소유한다', () => {
    expect(MOBILE_TABLE_DISPLAY_TYPES).toEqual(['radio', 'checkbox', 'table']);
    expect(
      makeAllQuestionVariants()
        .filter((question) => isMobileTableDisplayType(question.type))
        .map((question) => question.type),
    ).toEqual(['radio', 'checkbox', 'table']);
  });

  it('내장 테이블 capability 는 radio/checkbox/ranking/table 4유형뿐이다', () => {
    const verdicts = Object.fromEntries(
      makeAllQuestionVariants().map((q) => [q.type, isEmbeddedTableQuestion(q)]),
    );
    expect(verdicts).toEqual({
      text: false,
      textarea: false,
      radio: true,
      checkbox: true,
      select: false,
      multiselect: false,
      ranking: true,
      table: true,
      notice: false,
    });
  });

  it('옵션 리스트는 radio/checkbox/select/ranking, choiceGroups 는 radio/checkbox/ranking', () => {
    const all = makeAllQuestionVariants();
    expect(all.filter(isOptionListQuestion).map((q) => q.type)).toEqual([
      'radio',
      'checkbox',
      'select',
      'ranking',
    ]);
    expect(all.filter(isChoiceGroupCapableQuestion).map((q) => q.type)).toEqual([
      'radio',
      'checkbox',
      'ranking',
    ]);
  });

  it('유형별 분류 가드 9종은 자기 유형에서만 참이다', () => {
    const guardsByType = {
      text: isTextQuestion,
      textarea: isTextareaQuestion,
      radio: isRadioQuestion,
      checkbox: isCheckboxQuestion,
      select: isSelectQuestion,
      multiselect: isMultiselectQuestion,
      ranking: isRankingQuestion,
      table: isTableQuestion,
      notice: isNoticeQuestion,
    } as const;
    for (const question of makeAllQuestionVariants()) {
      for (const [type, guard] of Object.entries(guardsByType)) {
        expect(guard(question), `${type} 가드 × ${question.type} 입력`).toBe(
          question.type === type,
        );
      }
    }
  });

  it('가드는 flat Question 입력에서도 동작한다', () => {
    const flat: Question = toFlatQuestion(makeQuestion.table());
    expect(isEmbeddedTableQuestion(flat)).toBe(true);
    if (isEmbeddedTableQuestion(flat)) {
      // narrowing 후에도 flat 필드 접근이 유지되는지 (교차 타입)
      expect(flat.tableColumns).toBeDefined();
    }
  });

  it('switch 전수 분기 + assertNeverQuestionType 으로 exhaustiveness 가 컴파일 계약이 된다', () => {
    // 9유형 case 를 하나라도 지우면 default 의 type 이 never 가 아니게 되어 컴파일 에러.
    function classify(type: QuestionVariant['type']): string {
      switch (type) {
        case 'text':
        case 'textarea':
          return 'freeform';
        case 'radio':
        case 'checkbox':
        case 'select':
        case 'multiselect':
        case 'ranking':
          return 'choice';
        case 'table':
          return 'table';
        case 'notice':
          return 'static';
        default:
          return assertNeverQuestionType(type);
      }
    }
    for (const question of makeAllQuestionVariants()) {
      expect(classify(question.type)).toBeTruthy();
    }
    // 런타임 도달 시(타입 우회 데이터) 명시적으로 throw 한다
    expect(() => assertNeverQuestionType('file-upload' as never)).toThrow(
      '처리되지 않은 질문 유형',
    );
  });
});
