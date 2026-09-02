'use client';

import type { ContactResultCode } from '@/db/schema/schema-types';
import {
  FILTER_SOURCE,
  formatIdListToken,
  type ColumnCandidate,
} from '@/lib/operations/filter-shared';
import { describeIdListValue, expandRangesToIds } from '@/lib/operations/id-list-paste';
import {
  MAX_STORED_ID_LIST,
  parseIdListDetailed,
  SINGLE_COLUMN_ID_LIST_MAX,
} from '@/lib/operations/range-list';
import { client } from '@/shared/lib/rpc';

import {
  FilterBarCore,
  type ClientFilterClause,
} from '@/components/operations/filters/filter-bar-core';

import { ValueWidget } from './value-widget';

interface Props {
  surveyId: string;
  initialClauses: ClientFilterClause[];
  columnCandidates: ColumnCandidate[];
  resultCodeOptions: ContactResultCode[];
  /** 있을 때만 "컬럼 설정" 버튼 노출 (조사대상목록 전용). 메일 마법사는 미전달. */
  columnsSettingsHref?: string;
  /** form aria-label. 기본 "조사 대상 필터". */
  ariaLabel?: string;
  /** 초기화 버튼이 함께 지울 페이지 전용 필터 파라미터 (메일 마법사의 unresponded 등). */
  resetExtraParams?: string[];
}

/**
 * 조사 대상 필터 — 공용 FilterBarCore 의 컨택 전용 wrapper.
 * 값 위젯(결과코드/web 상태 dropdown)과 web 기본값만 이 페이지 특화.
 */
export function ContactsFilterBar({
  surveyId,
  initialClauses,
  columnCandidates,
  resultCodeOptions,
  columnsSettingsHref,
  ariaLabel = '조사 대상 필터',
  resetExtraParams,
}: Props) {
  /**
   * 검색 직전 절 값 변환 — 시스템ID/attrs 의 ID 목록만 다룬다.
   * - 숫자 아닌 값이 섞인 목록은 검색을 막는다 (서버가 텍스트로 접어 조용히 0건이 되는 사고 방지)
   * - 인라인 상한(2,000)을 넘으면 목록을 저장하고 `list:<uuid>:<count>` 토큰으로 바꾼다
   *   — URL 은 짧게, 검색·뒤로가기·캠페인 스냅샷 재현은 그대로
   */
  const prepareClauseValue = async (source: string, value: string): Promise<string> => {
    // 위젯 배지와 같은 판정(describeIdListValue)을 쓴다 — 화면이 경고한 것만 막힌다.
    const status = describeIdListValue(source, value);
    if (status.kind === 'invalid') {
      throw new Error(
        `숫자가 아닌 값 ${status.invalid.length}개가 있어 검색할 수 없습니다: ${status.invalid.slice(0, 5).join(', ')}`,
      );
    }
    if (status.kind === 'leadingZero') {
      throw new Error(
        `앞에 0이 붙은 번호 ${status.tokens.length}개는 목록 검색이 안 됩니다: ${status.tokens.slice(0, 5).join(', ')}`,
      );
    }
    if (status.kind !== 'list' || !status.overLimit) return value;
    const { ranges } = parseIdListDetailed(value, { maxTokens: SINGLE_COLUMN_ID_LIST_MAX });
    const ids = expandRangesToIds(ranges, MAX_STORED_ID_LIST);
    if (!ids) {
      throw new Error(
        `ID 목록은 한 번에 ${MAX_STORED_ID_LIST.toLocaleString('ko-KR')}개까지 검색할 수 있습니다.`,
      );
    }
    const { id, count } = await client.contacts.idLists.create({ surveyId, ids });
    return formatIdListToken(id, count);
  };

  return (
    <FilterBarCore
      initialClauses={initialClauses}
      prepareClauseValue={prepareClauseValue}
      columnCandidates={columnCandidates}
      ariaLabel={ariaLabel}
      {...(columnsSettingsHref !== undefined ? { columnsSettingsHref } : {})}
      {...(resetExtraParams !== undefined ? { resetExtraParams } : {})}
      renderValueWidget={({ source, value, onChange, inputId }) => (
        <ValueWidget
          source={source}
          value={value}
          onChange={onChange}
          resultCodeOptions={resultCodeOptions}
          {...(inputId !== undefined ? { inputId } : {})}
        />
      )}
      // 상태 dropdown 컬럼은 기본값으로 초기화 (빈 value 면 silent drop 함정) —
      // web 은 completed, 메일은 delivered. 레거시 'true' 는 구 URL 복원 전용.
      defaultValueForSource={(source) =>
        source === FILTER_SOURCE.WEB
          ? 'completed'
          : source === FILTER_SOURCE.EMAIL
            ? 'delivered'
            : ''
      }
    />
  );
}
