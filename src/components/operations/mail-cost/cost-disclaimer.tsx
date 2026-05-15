import { AlertTriangle, Info } from 'lucide-react';

import { formatInt } from './_format';

interface DisclaimerProps {
  planLabel?: string;
  monthlyFeeKrw?: number;
  includedEmails?: number;
  overagePer1kKrw?: number;
}

export function CostDisclaimer({
  planLabel,
  monthlyFeeKrw,
  includedEmails,
  overagePer1kKrw,
}: DisclaimerProps) {
  if (
    planLabel === undefined ||
    monthlyFeeKrw === undefined ||
    includedEmails === undefined ||
    overagePer1kKrw === undefined
  ) {
    return null;
  }
  return (
    <aside className="flex gap-3 rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-blue-900">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
      <p className="leading-relaxed">
        <span className="font-medium">{planLabel}</span> · 월 구독료{' '}
        <span className="font-medium">{formatInt(monthlyFeeKrw)}원</span>으로{' '}
        <span className="font-medium">{formatInt(includedEmails)}건</span>까지 발송 가능, 초과 분은{' '}
        <span className="font-medium">1,000건당 {formatInt(overagePer1kKrw)}원</span>이 부과됩니다.
      </p>
    </aside>
  );
}

export function EmptyPeriodsNotice() {
  return (
    <aside className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="space-y-1">
        <p className="font-medium">요금제·결제일이 등록되지 않았습니다.</p>
        <p className="text-amber-800">
          상단 &ldquo;요금제·결제일 관리&rdquo; 버튼에서 Pro 50K 요금제와 결제일을 등록해주세요. 등록 전에는 비용이
          모두 0원으로 표시됩니다.
        </p>
      </div>
    </aside>
  );
}
