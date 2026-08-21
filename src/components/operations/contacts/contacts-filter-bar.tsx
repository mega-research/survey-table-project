'use client';

import type { ContactResultCode } from '@/shared/contracts/contacts';
import { FILTER_SOURCE, type ColumnCandidate } from '@/lib/operations/filter-shared';

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
}

/**
 * 조사 대상 필터 — 공용 FilterBarCore 의 컨택 전용 wrapper.
 * 값 위젯(결과코드/web 상태 dropdown)과 web 기본값만 이 페이지 특화.
 */
export function ContactsFilterBar({
  initialClauses,
  columnCandidates,
  resultCodeOptions,
  columnsSettingsHref,
  ariaLabel = '조사 대상 필터',
}: Props) {
  return (
    <FilterBarCore
      initialClauses={initialClauses}
      columnCandidates={columnCandidates}
      ariaLabel={ariaLabel}
      {...(columnsSettingsHref !== undefined ? { columnsSettingsHref } : {})}
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
