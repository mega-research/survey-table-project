'use client';

import type { MatchContactUploadResult } from '@/server/contacts/domain/contact-upload';
import { Button } from '@/components/ui/button';

interface UploadMatchStepProps {
  mode: 'merge' | 'append';
  result: MatchContactUploadResult;
  unmatchedPolicy: 'insert' | 'skip';
  duplicatePolicy: 'insert' | 'skip';
  onUnmatchedPolicyChange: (p: 'insert' | 'skip') => void;
  onDuplicatePolicyChange: (p: 'insert' | 'skip') => void;
  onBack: () => void;
  onConfirm: () => void;
  isPending: boolean;
}

function SampleList({
  title,
  samples,
  total,
}: {
  title: string;
  samples: MatchContactUploadResult['unmatchedSamples'];
  total: number;
}) {
  if (total === 0) return null;
  return (
    <details className="rounded border border-slate-200 bg-white px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium text-slate-700">
        {title} {total.toLocaleString('ko-KR')}건{total > samples.length && ` (샘플 ${samples.length}건 표시)`}
      </summary>
      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-slate-600">
        {samples.map((s) => (
          <li key={s.excelRow}>
            {s.excelRow}행 — {Object.entries(s.keyValues).map(([k, v]) => `${k}: ${v || '(빈 값)'}`).join(' / ')}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function UploadMatchStep({
  mode,
  result,
  unmatchedPolicy,
  duplicatePolicy,
  onUnmatchedPolicyChange,
  onDuplicatePolicyChange,
  onBack,
  onConfirm,
  isPending,
}: UploadMatchStepProps) {
  const autoSkipped = result.fileDuplicates + result.multiMatches + result.emptyKeys;
  const isMerge = mode === 'merge';

  return (
    <div className="space-y-4">
      {/* 요약 카운터 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: isMerge ? '갱신 예정' : '중복', value: result.matched, tone: 'text-blue-600' },
          { label: isMerge ? '불일치' : '신규', value: result.unmatched, tone: 'text-slate-700' },
          { label: '파일 내 키 중복', value: result.fileDuplicates, tone: 'text-amber-600' },
          { label: '다중 일치·키 빈 값', value: result.multiMatches + result.emptyKeys, tone: 'text-amber-600' },
        ].map((c) => (
          <div key={c.label} className="rounded border bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-500">{c.label}</div>
            <div className={`text-lg font-semibold tabular-nums ${c.tone}`}>
              {c.value.toLocaleString('ko-KR')}
            </div>
          </div>
        ))}
      </div>

      {/* 빈 값 덮어쓰기 경고 */}
      {isMerge && result.emptyOverwrites.length > 0 && (
        <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="font-semibold">빈 값 덮어쓰기 발생</div>
          <ul className="mt-1 ml-4 list-disc text-xs">
            {result.emptyOverwrites.map((s) => (
              <li key={s.columnKey}>
                {s.columnKey}: {s.count.toLocaleString('ko-KR')}건
                {s.isPii && <strong> — 저장된 개인정보 값이 삭제됩니다</strong>}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-xs">
            해당 컬럼 값을 유지하려면 파일에서 그 열 자체를 제거한 뒤 다시 업로드하세요.
          </div>
        </div>
      )}

      {/* 정책 선택 */}
      {isMerge ? (
        result.unmatched > 0 && (
          <div className="space-y-1 rounded border p-3 text-sm">
            <div className="font-medium text-slate-700">
              불일치 {result.unmatched.toLocaleString('ko-KR')}건 처리
            </div>
            {(
              [
                { value: 'skip', label: '제외 (갱신만 수행)' },
                { value: 'insert', label: '신규로 추가 (새 번호 발번)' },
              ] as const
            ).map((opt) => (
              <label key={opt.value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="unmatched-policy"
                  checked={unmatchedPolicy === opt.value}
                  onChange={() => onUnmatchedPolicyChange(opt.value)}
                  className="h-4 w-4"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        )
      ) : (
        result.matched + result.multiMatches > 0 && (
          <div className="space-y-1 rounded border p-3 text-sm">
            <div className="font-medium text-slate-700">
              중복 {(result.matched + result.multiMatches).toLocaleString('ko-KR')}건 처리
            </div>
            {(
              [
                { value: 'skip', label: '제외 (신규만 추가)' },
                { value: 'insert', label: '그래도 추가' },
              ] as const
            ).map((opt) => (
              <label key={opt.value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="duplicate-policy"
                  checked={duplicatePolicy === opt.value}
                  onChange={() => onDuplicatePolicyChange(opt.value)}
                  className="h-4 w-4"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        )
      )}

      {isMerge && autoSkipped > 0 && (
        <div className="text-xs text-slate-500">
          파일 내 키 중복·다중 일치·키 빈 값 {autoSkipped.toLocaleString('ko-KR')}건은 갱신 대상이
          모호해 자동 제외됩니다.
        </div>
      )}

      {!isMerge && result.fileDuplicates + result.emptyKeys > 0 && (
        <div className="text-xs text-slate-500">
          파일 내 키 중복·키 빈 값 행은 서로 간 중복 검사 없이 추가되며, 기존 명단과 일치하는 행은 위
          선택을 따릅니다.
        </div>
      )}

      <SampleList title={isMerge ? '불일치 행' : '신규 행'} samples={result.unmatchedSamples} total={result.unmatched} />
      <SampleList title="파일 내 키 중복 행" samples={result.fileDuplicateSamples} total={result.fileDuplicates} />
      <SampleList title="다중 일치 행" samples={result.multiMatchSamples} total={result.multiMatches} />
      <SampleList title="키 빈 값 행" samples={result.emptyKeySamples} total={result.emptyKeys} />

      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack} disabled={isPending}>
          컬럼 설정으로
        </Button>
        <Button onClick={onConfirm} disabled={isPending}>
          {isPending ? '적재 중…' : '적재 시작'}
        </Button>
      </div>
    </div>
  );
}
