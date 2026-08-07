import type { CheckboxOption, QuestionOption, RadioOption } from '@/types/survey';

/** optionCode/spssNumericCode/isCustomOptionCode를 가진 옵션 공통 인터페이스 */
type CodeableOption = (QuestionOption | CheckboxOption | RadioOption) & {
  isCustomOptionCode?: boolean;
};

// ── 코드 생성 ──

/** 제로패딩된 optionCode 생성. totalCount에 따라 자릿수 자동 결정 */
export function generateOptionCode(index: number, totalCount: number): string {
  const digits = totalCount >= 100 ? 3 : totalCount >= 10 ? 2 : 1;
  return String(index + 1).padStart(digits, '0');
}

/** 옵션 배열에서 최대 spssNumericCode를 구한�� */
export function getMaxSpssCode(options?: { spssNumericCode?: number | undefined }[]): number {
  if (!options || options.length === 0) return 0;
  return options.reduce(
    (max, o) => (o.spssNumericCode != null && o.spssNumericCode > max ? o.spssNumericCode : max), 0,
  );
}

/**
 * 새 옵션의 value 번호를 발번한다 — 같은 옵션 목록 안에서 유일 보장.
 * 선택 응답이 option.value 로 키잉되므로 value 중복은 두 옵션이 같은 선택키를
 * 공유하는 오작동(하나를 누르면 다른 쪽이 켜짐)과 응답 병합을 일으킨다.
 * length+1 부터 시작하되 `${prefix}${n}` 이 기존 value 와 충돌하면 다음 번호로
 * 올린다 — 중간 삭제 이력이 있는 목록에서 length 기반 발번이 재탕되는 것을 방지.
 */
export function nextUniqueOptionNumber(
  existing: Array<{ value?: string }>,
  prefix: string,
): number {
  const used = new Set(existing.map((o) => o.value));
  let n = existing.length + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return n;
}

/**
 * 사용자가 직접 입력한 optionCode(응답값)를 반영하고, 유일하면 value도 동기화한다.
 * value는 선택 응답의 저장 키 — 충돌 시 동기화를 보류해 응답 키 충돌(교차 선택 버그)을 막는다.
 * 자동 발번 코드는 위치 기반이라 여기서 다루지 않는다 (빈 code 입력 = 자동 발번 복귀).
 */
export function applyCustomOptionCode<
  T extends { value: string; optionCode?: string; isCustomOptionCode?: boolean },
>(options: T[], index: number, code: string): {
  options: T[];
  valueChange: { oldValue: string; newValue: string } | null;
} {
  const target = options[index];
  if (!target) return { options, valueChange: null };

  if (code === '') {
    const next = [...options];
    next[index] = { ...target, optionCode: undefined, isCustomOptionCode: false };
    return { options: next, valueChange: null };
  }

  const collides = options.some(
    (o, i) => i !== index && (o.optionCode === code || o.value === code),
  );
  const next = [...options];
  if (collides || target.value === code) {
    next[index] = { ...target, optionCode: code, isCustomOptionCode: true };
    return { options: next, valueChange: null };
  }
  const oldValue = target.value;
  next[index] = { ...target, optionCode: code, isCustomOptionCode: true, value: code };
  return { options: next, valueChange: { oldValue, newValue: code } };
}

/** 기타 옵션의 코드를 구한다 (other-option의 spssNumericCode, 없으면 max + 1 fallback) */
export function getOtherOptionCode(options?: { id?: string; spssNumericCode?: number | undefined }[]): string {
  const otherOpt = options?.find((o) => o.id === 'other-option');
  if (otherOpt?.spssNumericCode != null) return String(otherOpt.spssNumericCode);
  return String(getMaxSpssCode(options) + 1);
}

// ── 커스텀 판별 ──

/** 기존 optionCode가 있고 isCustomOptionCode가 undefined이면 커스텀으로 간주 (기존 데이터 보호) */
function isEffectivelyCustom(option: CodeableOption): boolean {
  if (option.isCustomOptionCode === true) return true;
  if (option.isCustomOptionCode === undefined && option.optionCode) return true;
  return false;
}

// ── 일괄 생성 ──

/** 옵션 배열에 optionCode + spssNumericCode 일괄 할당. 변경 없으면 원본 참조 반환. */
export function generateAllOptionCodes<T extends CodeableOption>(options: T[]): T[] {
  const totalCount = options.length;
  let nextSpssCode = getMaxSpssCode(options) + 1;

  return options.map((opt, index) => {
    if (isEffectivelyCustom(opt)) {
      // 커스텀 코드는 건드리지 않되, spssNumericCode만 없으면 할당
      if (opt.spssNumericCode == null) {
        return { ...opt, spssNumericCode: nextSpssCode++ };
      }
      return opt;
    }

    const newOptionCode = generateOptionCode(index, totalCount);
    // spssNumericCode가 이미 있으면 유지 (삭제 후에도 번호 보존)
    const newSpssCode = opt.spssNumericCode ?? nextSpssCode++;

    if (
      opt.optionCode === newOptionCode &&
      opt.isCustomOptionCode === false &&
      opt.spssNumericCode === newSpssCode
    ) {
      return opt; // 변경 없으면 원본 참조 유지
    }

    return {
      ...opt,
      optionCode: newOptionCode,
      isCustomOptionCode: false,
      spssNumericCode: newSpssCode,
    };
  });
}

// ── DB 저장 최적화 ──

/** DB 저장 전 자동생성 필드를 제거한다. 로드 시 generateAllOptionCodes()로 복원. */
export function stripOptionCodes<T extends CodeableOption>(options: T[]): T[] {
  return options.map((opt) => {
    if (opt.isCustomOptionCode !== false) return opt;

    const stripped = { ...opt };
    delete stripped.optionCode;
    delete stripped.isCustomOptionCode;
    // spssNumericCode는 삭제 시 번호 유지가 필요하므로 보존
    return stripped;
  });
}
