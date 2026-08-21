'use client';

import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

import type { ComparisonResult } from '@/lib/lookup/evaluate-comparison';

interface Props {
  conditionLabel: string;
  result: ComparisonResult;
}

const REASON_LABELS: Record<string, string> = {
  'attrs-key-missing': 'attrs 키 비어있음',
  'lookup-not-found': '설문에 LUT 등록 안 됨',
  'lookup-row-not-matched': 'LUT 행 매칭 실패',
  'lookup-value-missing': 'LUT 값 컬럼 누락',
  'cell-value-missing': '셀 응답 없음',
  'cell-value-not-number': '셀 응답이 숫자 아님',
  'divide-by-zero': '0 으로 나누기',
};

/**
 * 빌더 테스트 모드 전용 디버그 패널.
 * displayCondition 의 numericComparison 평가 결과를 색상·아이콘으로 시각화한다.
 *
 * - 충족: green, CheckCircle2
 * - 미충족: gray, X
 * - fail-safe SHOW: amber, AlertTriangle + 사유 표시 (응답자 본인에게는 노출되지 않음을 명시)
 */
export function ConditionDebugPanel({ conditionLabel, result }: Props) {
  const { satisfied, failSafeShow, reason, debug } = result;

  const containerCls = failSafeShow
    ? 'border-amber-200 bg-amber-50'
    : satisfied
      ? 'border-green-200 bg-green-50'
      : 'border-gray-200 bg-gray-50';

  const statusLabel = failSafeShow
    ? '평가 불가 → fail-safe SHOW'
    : satisfied
      ? '충족 → SHOW'
      : '미충족 → HIDE';

  return (
    <div className={`rounded border p-3 text-sm ${containerCls}`}>
      <div className="flex items-center gap-2 font-medium">
        {failSafeShow ? (
          <AlertTriangle size={14} className="text-amber-600" />
        ) : satisfied ? (
          <CheckCircle2 size={14} className="text-green-600" />
        ) : (
          <X size={14} className="text-gray-500" />
        )}
        <span>{conditionLabel}</span>
        <span className="ml-auto text-xs">{statusLabel}</span>
      </div>

      {debug && debug.leftValue !== undefined && (
        <div className="mt-1 text-xs text-gray-700">
          좌변: {debug.leftValue} · 우변: {debug.rightValue}
        </div>
      )}

      {failSafeShow && reason && (
        <div className="mt-1 text-xs text-amber-700">
          사유: {REASON_LABELS[reason] ?? reason}
          <span className="ml-2 text-gray-500">
            (실제 응답자에게는 이 안내가 표시되지 않습니다)
          </span>
        </div>
      )}
    </div>
  );
}
