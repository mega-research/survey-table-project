'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useSearchParamsMutator } from '@/features/operations/hooks/use-search-params-mutator';
import { getErrorMessage } from '@/lib/get-error-message';
import type { ColumnCandidate } from '@/lib/operations/filter-shared';
import type { ClientFilterClause } from '@/lib/operations/filter-shared';
import {
  clearHeaderFilterParams,
  hasHeaderFilterParams,
} from '@/features/operations/filters/header-filter-url';

import {
  clausesToDraftRows,
  draftRowsToClauses,
  FilterBarCore,
  type FilterDraftRow,
  type RenderValueWidget,
} from './filter-bar-core';
import { FilterResetButton } from './filter-reset-button';

interface Props {
  initialClauses: ClientFilterClause[];
  columnCandidates: ColumnCandidate[];
  renderValueWidget: RenderValueWidget;
  /** source 변경/조건 추가 시 초기 value. 기본 빈 문자열. */
  defaultValueForSource?: (source: string) => string;
  ariaLabel: string;
  /** 있을 때만 "컬럼 설정" 버튼 노출. */
  columnsSettingsHref?: string;
  /** 검색 버튼 뒤에 붙는 페이지 전용 컨트롤 (예: 응답 내역 상태 select). */
  trailing?: React.ReactNode;
  /** 검색 실행 시 URL 파라미터 추가 조작 (예: status 반영). */
  onSubmitParams?: (p: URLSearchParams) => void;
  /** 초기화 버튼이 함께 지울 페이지 전용 필터 파라미터 (예: 응답 내역 status). */
  resetExtraParams?: string[];
  /**
   * 검색 직전 절 값 변환 (예: 인라인 상한을 넘는 ID 목록 → 서버 저장 후 `list:` 토큰).
   * throw 하면 메시지를 띄우고 검색하지 않는다 — 조용히 0건이 되는 것보다 낫다.
   */
  prepareClauseValue?: (source: string, value: string) => Promise<string>;
}

/**
 * 검색 결과를 주소(URL)에 싣는 필터 검색바 — 조사 대상·응답 내역·단체 메일 마법사 공용.
 *
 * 조건 편집은 제어형 FilterBarCore 가 하고, 이 래퍼는 URL 쪽 동작만 맡는다.
 * - URL ?col[]=&q[]=&op[]= multi-value 직렬화. 빈 value 절은 [검색] 시 silent drop.
 * - 헤더 깔때기 필터와 상호배타 — 검색 시 헤더 필터는 경고 후 해제.
 * - 검색·초기화 시 page 를 지운다.
 */
export function UrlFilterBar({
  initialClauses,
  columnCandidates,
  renderValueWidget,
  defaultValueForSource,
  ariaLabel,
  columnsSettingsHref,
  trailing,
  onSubmitParams,
  resetExtraParams = [],
  prepareClauseValue,
}: Props) {
  const [rows, setRows] = useState<FilterDraftRow[]>(() => clausesToDraftRows(initialClauses));
  const [exclusionConfirmOpen, setExclusionConfirmOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  // 초기화 시 코어의 펼침 상태까지 처음으로 — URL 이 그대로여도 코어를 새로 그린다.
  const [resetNonce, setResetNonce] = useState(0);
  const [, startTransition] = useTransition();
  const pushParams = useSearchParamsMutator();
  const searchParams = useSearchParams();

  // 브라우저 뒤로/앞으로 가기 시 동기화 — effect 대신 렌더 중 조정 패턴.
  // 참조가 아니라 직렬화 키로 비교해 매 렌더 새 배열 참조에도 reset 되지 않게 한다.
  const initialClausesKey = JSON.stringify(initialClauses);
  const [prevInitialClausesKey, setPrevInitialClausesKey] = useState(initialClausesKey);
  if (prevInitialClausesKey !== initialClausesKey) {
    setPrevInitialClausesKey(initialClausesKey);
    setRows(clausesToDraftRows(initialClauses));
  }

  const runSearch = async () => {
    const pending = draftRowsToClauses(rows);
    let prepared = pending;
    if (prepareClauseValue) {
      setPreparing(true);
      try {
        prepared = await Promise.all(
          pending.map(async (c) => ({ ...c, value: await prepareClauseValue(c.source, c.value) })),
        );
      } catch (err) {
        toast.error(getErrorMessage(err, '검색 조건을 준비하지 못했습니다.'));
        return;
      } finally {
        setPreparing(false);
      }
    }
    startTransition(() => {
      pushParams((p) => {
        p.delete('col');
        p.delete('q');
        p.delete('op');
        prepared.forEach((c) => p.append('col', c.source));
        prepared.forEach((c) => p.append('q', c.value));
        prepared.forEach((c) => p.append('op', c.op));
        // 필터 모드 상호배타 — 빌더 검색 시 헤더 필터는 항상 해제.
        clearHeaderFilterParams(p);
        p.delete('page');
        onSubmitParams?.(p);
      });
    });
  };

  const handleSearch = () => {
    // 헤더 필터가 활성이면 경고 후 진행 (확인 시 헤더 필터 폐기).
    if (hasHeaderFilterParams(new URLSearchParams(searchParams.toString()))) {
      setExclusionConfirmOpen(true);
      return;
    }
    void runSearch();
  };

  return (
    <>
      <FilterBarCore
        key={`${initialClausesKey}#${resetNonce}`}
        rows={rows}
        onRowsChange={setRows}
        onSubmit={handleSearch}
        columnCandidates={columnCandidates}
        renderValueWidget={renderValueWidget}
        {...(defaultValueForSource !== undefined ? { defaultValueForSource } : {})}
        ariaLabel={ariaLabel}
        {...(columnsSettingsHref !== undefined ? { columnsSettingsHref } : {})}
        trailing={trailing}
        submitDisabled={preparing}
        resetControl={
          <FilterResetButton
            className="h-10"
            clearParams={['col', 'q', 'op', 'hcol', 'hm', 'hv', 'page', ...resetExtraParams]}
            activeParams={['col', 'q', 'op', 'hcol', 'hm', 'hv', ...resetExtraParams]}
            onReset={() => {
              // URL 변화가 서버 initial 로 되돌아와 동기화되지만, 검색 전 입력값은
              // URL 에 없어 남는다 — 로컬 state 도 즉시 비운다.
              setRows([]);
              setResetNonce((n) => n + 1);
            }}
          />
        }
      />

      <AlertDialog open={exclusionConfirmOpen} onOpenChange={setExclusionConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>헤더 필터가 해제됩니다</AlertDialogTitle>
            <AlertDialogDescription>
              컬럼 헤더에 걸어둔 필터와 검색 조건은 동시에 사용할 수 없습니다. 계속하면
              헤더 필터가 해제되고 검색 조건만 적용됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setExclusionConfirmOpen(false);
                void runSearch();
              }}
            >
              검색 실행
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
