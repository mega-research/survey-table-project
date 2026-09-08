'use client';

/**
 * 입력 형식 선택 — 단답형 문항 · 표 input 셀 · 보기 상세기재 · choice_opt 셀 네 자리가 공유한다.
 *
 * 네 자리가 같은 값 목록·같은 문구·같은 "지정 안 함" 의미를 쓰므로 한 곳에 둔다. 흩어 두면
 * 형식이 하나 늘 때 네 파일을 만져야 하고, 그중 하나를 빠뜨려도 아무도 모른다.
 */
import { INPUT_FORMATS, type InputType, isInputFormat } from '@/types/input-type';
import { INPUT_FORMAT_LABEL } from '@/utils/input-format';

interface Props {
  /** 같은 화면에 여러 개가 동시에 렌더되므로 id 충돌을 막는 접두어. */
  id: string;
  /** 현재 입력 모드. 형식이 아니면 "지정 안 함"으로 보인다. */
  value: InputType | undefined;
  /** 형식을 고르면 그 값, 지우면 'text'. 숫자 모드로는 이 컨트롤로 갈 수 없다. */
  onChange: (next: InputType) => void;
  /** 라벨·설명 글자 크기 — 문항 편집(sm)과 보기 행 아래(xs) 밀도가 다르다. */
  size?: 'sm' | 'xs';
  /** 형식을 고른 상태에서 옆에 붙는 안내. 좁은 자리(보기 행)에서는 끈다. */
  showHint?: boolean;
}

export function InputFormatSelect({ id, value, onChange, size = 'sm', showHint = true }: Props) {
  const isXs = size === 'xs';
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={id}
        className={isXs ? 'shrink-0 text-[10px] text-gray-400' : 'text-sm font-medium'}
      >
        입력 형식
      </label>
      <select
        id={id}
        value={isInputFormat(value) ? value : ''}
        onChange={(e) => {
          const next = e.target.value;
          onChange(isInputFormat(next) ? next : 'text');
        }}
        className={
          isXs
            ? 'h-7 rounded-md border border-gray-300 px-2 text-xs'
            : 'h-8 rounded-md border border-gray-300 px-2 text-sm'
        }
      >
        <option value="">지정 안 함</option>
        {INPUT_FORMATS.map((format) => (
          <option key={format} value={format}>
            {INPUT_FORMAT_LABEL[format]}
          </option>
        ))}
      </select>
      {showHint && isInputFormat(value) && (
        <span className="text-xs text-gray-500">
          형식이 맞지 않으면 응답자가 다음으로 넘어가지 못합니다
        </span>
      )}
    </div>
  );
}
