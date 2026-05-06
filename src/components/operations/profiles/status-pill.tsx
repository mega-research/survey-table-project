import { cn } from '@/lib/utils';
import type { StatusPillResult } from '@/lib/operations/profiles';

interface Props {
  pill: StatusPillResult;
}

const TONE_CLASS: Record<StatusPillResult['tone'], string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  gray: 'bg-slate-50 text-slate-600 border-slate-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-rose-50 text-rose-700 border-rose-200',
};

/**
 * 운영 콘솔 응답자 목록 — 상태 pill.
 *
 * 6종 status 별 tone 색상 + in_progress 일 때 부속 텍스트(`5/50 · Q3`)를
 * pill 우측에 작게 노출한다. mapStatusPill 의 결과를 그대로 시각화.
 */
export function StatusPill({ pill }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONE_CLASS[pill.tone],
      )}
    >
      <span>{pill.label}</span>
      {pill.sub && <span className="font-normal opacity-80">· {pill.sub}</span>}
    </span>
  );
}
