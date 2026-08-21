import { cn } from '@/lib/utils';
import type { GroupNameDesign } from '@/types/survey';

/**
 * 응답 페이지 루트 그룹 이름 배지. design 미설정/부분설정 시 기본 라이트 블루 배지로 폴백.
 */
export function RootGroupNameBadge({
  name,
  design,
}: {
  name: string;
  design?: GroupNameDesign | undefined;
}) {
  const { fullWidth, bgColor, textColor } = design ?? {};
  return (
    <span
      className={cn(
        'inline-block rounded-md px-3.5 py-2 text-base font-semibold tracking-wide',
        fullWidth ? 'w-full' : 'w-fit',
        bgColor ? '' : 'bg-blue-50',
        textColor ? '' : 'text-blue-700',
      )}
      style={{
        ...(bgColor ? { backgroundColor: bgColor } : {}),
        ...(textColor ? { color: textColor } : {}),
      }}
    >
      {name}
    </span>
  );
}
