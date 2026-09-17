'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Filter } from 'lucide-react';

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
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ContactResultCode } from '@/shared/contracts/contacts';
import type { PiiFieldType } from '@/lib/crypto/pii-fields';
import { useSearchParamsMutator } from '@/features/operations/hooks/use-search-params-mutator';
import { FILTER_SOURCE, placeholderFor, webFilterOptionsFor } from '@/lib/operations/filter-shared';
import {
  contactResultFilterOptions,
  FILTER_NONE_LABEL,
  FILTER_NONE_TOGGLE_LABEL,
  FILTER_NONE_VALUE,
  FILTER_NOT_NONE_TOGGLE_LABEL,
  FILTER_NOT_NONE_VALUE,
} from '@/lib/operations/filter-shared';
import {
  hasBuilderFilterParams,
  joinHeaderValues,
  parseHeaderFilterEntries,
  removeHeaderFilter,
  splitHeaderValues,
  upsertHeaderFilter,
  type HeaderFilterEntry,
} from '@/features/operations/filters/header-filter-url';
import { client } from '@/shared/lib/rpc';

interface Props {
  surveyId: string;
  /** attrs.* | pii.* | system.contact_result | system.web | fixedOptions 지정 source */
  source: string;
  label: string;
  piiType?: PiiFieldType;
  /** system.contact_result 체크박스 옵션 — 조사 대상 전용. */
  resultCodeOptions?: ContactResultCode[];
  /**
   * 페이지 전용 source 의 고정 옵션 체크박스 (예: 응답 내역 status).
   * 지정하면 source 형태와 무관하게 in 모드 체크박스로 동작한다.
   */
  fixedOptions?: Array<{ value: string; label: string }>;
  /**
   * 적용 시 URL 파라미터 추가 조작 (예: 응답 내역 status 깔때기 적용 시 상단
   * 상태 select 의 'status' 제거 — 남겨두면 모순 AND 로 0건이 된다).
   * 클라이언트 컴포넌트에서만 넘길 수 있다 — 서버 컴포넌트는 아래 두 prop 을 쓴다.
   */
  onApplyParams?: (p: URLSearchParams) => void;
  /**
   * 적용 시 파라미터 이름 승격. 깔때기 적용은 빌더 파라미터(col/q/op)를 지우므로,
   * 'q' 를 다른 뜻으로 쓰는 페이지는 지워지기 전에 자기 이름으로 옮겨야 한다.
   * 직렬화 가능하므로 서버 컴포넌트에서도 넘길 수 있다.
   */
  renameOnApply?: { from: string; to: string };
  /**
   * 적용 시 함께 지울 파라미터 (예: 수신자 목록의 'recipPage').
   * 공용 헬퍼는 'page' 만 리셋하므로 페이지 전용 이름은 여기로 알린다.
   */
  resetParams?: string[];
}

type Kind = 'attrs' | 'pii' | 'result' | 'web' | 'fixed';

function kindOf(source: string, hasFixedOptions: boolean): Kind | null {
  if (hasFixedOptions) return 'fixed';
  if (source.startsWith(FILTER_SOURCE.ATTRS_PREFIX)) return 'attrs';
  if (source.startsWith(FILTER_SOURCE.PII_PREFIX)) return 'pii';
  if (source === FILTER_SOURCE.CONTACT_RESULT) return 'result';
  if (source === FILTER_SOURCE.WEB) return 'web';
  return null;
}

/**
 * 컬럼 헤더의 엑셀식 필터 드롭다운.
 *
 * - attrs 저카디널리티: distinct 체크박스 (컬럼 내 OR)
 * - attrs 고카디널리티(truncated): 부분검색 입력 폴백
 * - pii: 전문 일치 입력 (blind index — distinct 열거 불가)
 * - system.contact_result / system.web: 고정 옵션 체크박스
 *
 * 적용 시 빌더(col/q/op) 필터가 활성이면 경고 다이얼로그 후 빌더 조건을 폐기한다
 * (필터 모드 상호배타). distinct 조회는 첫 열기(또는 hover 프리페치) 시 1회 +
 * TanStack Query 캐시.
 */
export function HeaderFilterPopover({
  surveyId,
  source,
  label,
  resultCodeOptions = [],
  fixedOptions,
  onApplyParams,
  renameOnApply,
  resetParams,
}: Props) {
  const kind = kindOf(source, fixedOptions != null && fixedOptions.length > 0);
  const searchParams = useSearchParams();
  const pushParams = useSearchParamsMutator();

  const activeEntry = useMemo(
    () => parseHeaderFilterEntries(new URLSearchParams(searchParams.toString())).find((e) => e.source === source) ?? null,
    [searchParams, source],
  );

  const [open, setOpen] = useState(false);
  const [warm, setWarm] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [textValue, setTextValue] = useState('');
  // 부분검색/전문일치 입력 컬럼(고카디널리티 attrs, pii)의 빈 값 토글.
  // 체크박스 컬럼은 목록 안의 FILTER_NONE_LABEL 항목으로 같은 일을 한다.
  const [emptyOnly, setEmptyOnly] = useState(false);
  // 위 토글의 여집합 — 값이 있는 행만. 둘은 서로를 끈다 (동시에 켜면 0건).
  const [excludeEmpty, setExcludeEmpty] = useState(false);
  const [confirmEntry, setConfirmEntry] = useState<HeaderFilterEntry | null>(null);

  const attrsKey = kind === 'attrs' ? source.slice(FILTER_SOURCE.ATTRS_PREFIX.length) : null;
  const { data, isPending, isError } = useQuery({
    queryKey: ['contact-attr-values', surveyId, attrsKey],
    queryFn: () => client.contacts.attrValues.list({ surveyId, attrsKey: attrsKey ?? '' }),
    enabled: attrsKey != null && (open || warm),
    staleTime: 60_000,
  });

  if (kind == null) return null;

  const isCheckboxKind =
    kind === 'result' ||
    kind === 'web' ||
    kind === 'fixed' ||
    (kind === 'attrs' && data != null && !data.truncated);
  const isTextKind = kind === 'pii' || (kind === 'attrs' && data?.truncated === true);

  const checkboxOptions: Array<{ value: string; optionLabel: string }> =
    kind === 'fixed'
      ? (fixedOptions ?? []).map((o) => ({ value: o.value, optionLabel: o.label }))
      : kind === 'result'
        ? contactResultFilterOptions(resultCodeOptions).map((o) => ({
            value: o.value,
            optionLabel: o.label,
          }))
        : kind === 'web'
          ? // 레거시 값 노출 규칙은 webFilterOptionsFor 주석 참조.
            webFilterOptionsFor(selected).map((o) => ({ value: o.value, optionLabel: o.label }))
          : [
              ...(data?.values ?? []).map((v) => ({ value: v, optionLabel: v })),
              // 비어 있는 행이 실제로 있을 때만 노출. 실제 값이 센티널 문자열을 선점하면
              // 실제 값이 이기므로(파서 우선순위) 모호한 항목은 내밀지 않는다.
              ...(data?.hasEmpty && !(data?.values ?? []).includes(FILTER_NONE_VALUE)
                ? [{ value: FILTER_NONE_VALUE, optionLabel: FILTER_NONE_LABEL }]
                : []),
            ];

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    // 열 때 현재 URL 상태로 로컬 상태 초기화.
    if (activeEntry?.mode === 'in') {
      const values = splitHeaderValues(activeEntry.hv);
      setSelected(new Set(values));
      setTextValue('');
      // 입력형 컬럼(pii·고카디널리티 attrs)에서 in 모드는 빈 값 토글 전용이다 (buildEntry 참조).
      setEmptyOnly(values.length === 1 && values[0] === FILTER_NONE_VALUE);
      setExcludeEmpty(values.length === 1 && values[0] === FILTER_NOT_NONE_VALUE);
    } else {
      setSelected(new Set());
      setTextValue(activeEntry?.hv ?? '');
      setEmptyOnly(false);
      setExcludeEmpty(false);
    }
  };

  const toggleValue = (value: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(value);
      else next.delete(value);
      return next;
    });
  };

  const buildEntry = (): HeaderFilterEntry | null => {
    if (isTextKind) {
      // 빈 값 여부는 값 비교가 아니라 부재 판정이라 검색어와 함께 걸 수 없다 —
      // 체크되면 입력을 무시하고 센티널 단독 in 절로 보낸다.
      if (emptyOnly) return { source, mode: 'in', hv: joinHeaderValues([FILTER_NONE_VALUE]) };
      if (excludeEmpty) {
        return { source, mode: 'in', hv: joinHeaderValues([FILTER_NOT_NONE_VALUE]) };
      }
      const trimmed = textValue.trim();
      if (trimmed.length === 0) return null;
      return { source, mode: kind === 'pii' ? 'exact' : 'text', hv: trimmed };
    }
    if (selected.size === 0) return null;
    const ordered = checkboxOptions.map((o) => o.value).filter((v) => selected.has(v));
    return { source, mode: 'in', hv: joinHeaderValues(ordered) };
  };

  const commit = (entry: HeaderFilterEntry | null) => {
    pushParams((p) => {
      if (entry) {
        // 이름 승격은 upsertHeaderFilter 의 빌더 파라미터 제거보다 먼저 — 순서가
        // 뒤집히면 옮기기 전에 값이 사라진다.
        if (renameOnApply) {
          const carried = p.get(renameOnApply.from);
          if (carried !== null && p.get(renameOnApply.to) === null) {
            p.set(renameOnApply.to, carried);
          }
        }
        upsertHeaderFilter(p, entry);
        for (const name of resetParams ?? []) p.delete(name);
        onApplyParams?.(p);
      } else {
        removeHeaderFilter(p, source);
        for (const name of resetParams ?? []) p.delete(name);
      }
    });
    setConfirmEntry(null);
    setOpen(false);
  };

  const handleApply = () => {
    const entry = buildEntry();
    if (entry && hasBuilderFilterParams(new URLSearchParams(searchParams.toString()))) {
      setConfirmEntry(entry);
      return;
    }
    commit(entry);
  };

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label} 필터`}
            onMouseEnter={() => setWarm(true)}
            className={`inline-flex items-center rounded p-0.5 hover:text-slate-900 ${
              activeEntry ? 'text-blue-600' : 'text-slate-400'
            }`}
          >
            <Filter className="h-3.5 w-3.5" fill={activeEntry ? 'currentColor' : 'none'} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <div className="mb-2 text-xs font-semibold text-slate-500">{label} 필터</div>

          {kind === 'attrs' && data == null && isPending && !isError && (
            <p className="py-2 text-sm text-slate-500">불러오는 중...</p>
          )}
          {kind === 'attrs' && isError && (
            <p className="py-2 text-sm text-red-600">값을 불러오지 못했습니다</p>
          )}

          {isCheckboxKind && (
            <div className="max-h-44 space-y-1 overflow-y-auto">
              {checkboxOptions.length === 0 ? (
                <p className="py-2 text-sm text-slate-500">선택할 값이 없습니다</p>
              ) : (
                checkboxOptions.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm normal-case hover:bg-slate-50"
                  >
                    <Checkbox
                      aria-label={opt.optionLabel}
                      checked={selected.has(opt.value)}
                      onCheckedChange={(checked) => toggleValue(opt.value, checked === true)}
                    />
                    <span className="truncate">{opt.optionLabel}</span>
                  </label>
                ))
              )}
            </div>
          )}

          {isTextKind && (
            <div className="space-y-1.5">
              {kind === 'attrs' && (
                <p className="text-xs text-slate-500">고유값이 많아 검색으로 필터링합니다</p>
              )}
              {kind === 'pii' && (
                <p className="text-xs text-slate-500">전체 값이 정확히 일치해야 합니다</p>
              )}
              <Input
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                placeholder={placeholderFor(source)}
                className="h-8 text-sm normal-case"
                disabled={emptyOnly || excludeEmpty}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleApply();
                  }
                }}
              />
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm normal-case hover:bg-slate-50">
                <Checkbox
                  aria-label={FILTER_NONE_TOGGLE_LABEL}
                  checked={emptyOnly}
                  onCheckedChange={(checked) => {
                    setEmptyOnly(checked === true);
                    // 반대쪽은 끈다 — 둘 다 켜면 서로 배타라 0건이 된다.
                    if (checked === true) setExcludeEmpty(false);
                  }}
                />
                <span>{FILTER_NONE_TOGGLE_LABEL}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm normal-case hover:bg-slate-50">
                <Checkbox
                  aria-label={FILTER_NOT_NONE_TOGGLE_LABEL}
                  checked={excludeEmpty}
                  onCheckedChange={(checked) => {
                    setExcludeEmpty(checked === true);
                    if (checked === true) setEmptyOnly(false);
                  }}
                />
                <span>{FILTER_NOT_NONE_TOGGLE_LABEL}</span>
              </label>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between">
            {activeEntry ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-slate-500"
                onClick={() => commit(null)}
              >
                필터 해제
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" size="sm" className="h-7 px-3 text-xs" onClick={handleApply}>
              적용
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog open={confirmEntry != null} onOpenChange={(o) => !o && setConfirmEntry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>검색 조건이 해제됩니다</AlertDialogTitle>
            <AlertDialogDescription>
              상단 검색기의 조건과 헤더 필터는 동시에 사용할 수 없습니다. 계속하면 상단
              검색 조건이 해제되고 헤더 필터만 적용됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmEntry && commit(confirmEntry)}>
              헤더 필터 적용
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
