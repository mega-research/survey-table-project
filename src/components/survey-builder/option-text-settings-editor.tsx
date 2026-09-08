'use client';

import { Input } from '@/components/ui/input';
import { isInputFormat } from '@/types/input-type';
import type { InputType, NumberFormat } from '@/types/survey';

import { InputFormatSelect } from './input-format-select';
import { NumberFormatFields } from './number-format-fields';
import type { OptionTextSettings } from './question-option-helpers';

interface OptionTextSettingsEditorProps {
  /** 같은 화면에 여러 옵션이 동시에 렌더되므로 체크박스 id 충돌을 막는 접두어 (보통 옵션 id). */
  idPrefix: string;
  placeholder: string | undefined;
  textInputType: InputType | undefined;
  numberFormat: NumberFormat | undefined;
  /** 세 필드를 항상 함께 넘긴다 — 받는 쪽은 `applyOptionTextSettings` 로 반영한다. */
  onChange: (next: OptionTextSettings) => void;
}

/**
 * 세 값에서 설정 객체를 만든다. `undefined` 는 키를 만들지 않는다 —
 * exactOptionalPropertyTypes 아래에서 `key: undefined` 리터럴이 타입 에러이기도 하고,
 * 저장 형태에 죽은 키를 남기지 않기 위한 것이기도 하다.
 */
function buildSettings(
  placeholder: string | undefined,
  textInputType: InputType | undefined,
  numberFormat: NumberFormat | undefined,
): OptionTextSettings {
  return {
    ...(placeholder !== undefined ? { textInputPlaceholder: placeholder } : {}),
    ...(textInputType !== undefined ? { textInputType } : {}),
    ...(numberFormat !== undefined ? { textInputNumberFormat: numberFormat } : {}),
  };
}

/**
 * 주관식(allowTextInput) 옵션의 사이드카 입력 설정 편집기.
 * 옵션 행 바로 아래에 들여쓰기되어 렌더된다. question-basic-tab / cell-choice-editor 공용.
 *
 * 숫자 모드는 `choice_opt` 셀 탭(choice-opt-cell-tab)과 같은 설정이며, 응답 화면
 * (`option-text-input`)·범위 검증·SPSS 내보내기가 이미 옵션의 `textInputType` 을 읽는다.
 * 여기는 그 값을 켤 자리일 뿐이다.
 */
export function OptionTextSettingsEditor({
  idPrefix,
  placeholder,
  textInputType,
  numberFormat,
  onChange,
}: OptionTextSettingsEditorProps) {
  const isNumber = textInputType === 'number';

  return (
    <div className="space-y-2 px-3 pb-3 pl-9">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[10px] text-gray-400">placeholder</span>
        <Input
          value={placeholder ?? ''}
          onChange={(e) => onChange(buildSettings(e.target.value, textInputType, numberFormat))}
          placeholder="상세 기재"
          className="h-7 text-xs"
        />
      </div>

      <InputFormatSelect
        id={`${idPrefix}-text-format`}
        value={textInputType}
        size="xs"
        showHint={false}
        // 형식을 고르면 숫자 서식은 버린다 — 형식과 숫자 모드는 배타다.
        onChange={(next) => onChange(buildSettings(placeholder, next, undefined))}
      />

      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          id={`${idPrefix}-text-number`}
          disabled={isInputFormat(textInputType)}
          checked={isNumber}
          // 끌 때 형식도 함께 버린다 — 다시 켰을 때 예전 단위가 되살아나면
          // "껐다 켰으니 기본값" 이라는 기대와 어긋난다.
          onChange={(e) =>
            onChange(
              e.target.checked
                ? buildSettings(placeholder, 'number', numberFormat)
                : buildSettings(placeholder, 'text', undefined),
            )
          }
          className="mt-0.5 h-4 w-4"
        />
        <label htmlFor={`${idPrefix}-text-number`} className="flex-1 cursor-pointer text-xs">
          <span className="font-medium">숫자만 입력</span>
          <p className="mt-0.5 text-[11px] text-gray-500">
            입력 셀과 같은 규칙 — 콤마 표시·단위·최소/최대·소수 자릿수·허용값을 쓸 수 있고, SPSS
            변수도 숫자형으로 내보냅니다.
          </p>
        </label>
      </div>

      {isNumber && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <NumberFormatFields
            idPrefix={`${idPrefix}-text-nf`}
            value={numberFormat}
            onChange={(next) => onChange(buildSettings(placeholder, textInputType, next))}
          />
        </div>
      )}
    </div>
  );
}
