'use client';

/**
 * 세그먼트 컨트롤 — 계정 생성 모달의 유형·역할 두 자리가 같은 모양을 쓴다.
 *
 * 같은 마크업이 한 파일에 두 벌 있으면 한쪽만 손보는 날이 온다(선택 색·높이가 갈린다).
 * 워크스페이스 안에서만 쓰므로 `components/ui` 로 올리지 않는다 — 그쪽은 진짜 공용 UI 다.
 */
interface Props<T extends string> {
  options: readonly T[];
  value: T;
  label: (option: T) => string;
  onChange: (option: T) => void;
  /** 선택할 수 없는 값 — 이유는 호출부가 안다(업체 지정 발급은 유형을 잠근다). */
  isDisabled?: (option: T) => boolean;
}

export function SegmentedChoice<T extends string>({
  options,
  value,
  label,
  onChange,
  isDisabled,
}: Props<T>) {
  return (
    <div className="flex gap-1 rounded-[10px] bg-[#EEF0F4] p-[3px]">
      {options.map((option) => {
        const selected = option === value;
        const disabled = isDisabled?.(option) ?? false;
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(option)}
            className={`h-[30px] flex-1 rounded-lg text-[12.5px] transition-colors ${
              selected
                ? 'bg-white font-semibold text-[#2743AE] shadow-sm'
                : 'text-[#6E6E73] hover:text-[#3A3A3C]'
            } ${disabled ? 'cursor-not-allowed opacity-50 hover:text-[#6E6E73]' : ''}`}
          >
            {label(option)}
          </button>
        );
      })}
    </div>
  );
}
