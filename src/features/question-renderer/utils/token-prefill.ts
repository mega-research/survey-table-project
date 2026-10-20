import { substituteTokens } from '@/lib/survey/substitute-tokens';

/** 토큰 치환에 쓰는 명단 값 — 검증 컨텍스트는 값이 빈 키를 undefined 로 들고 있을 수 있다 */
type PrefillAttrs = Record<string, string | undefined> | null | undefined;

/**
 * 토큰 프리필의 잠금 값. 템플릿이 없거나 **치환 결과가 비면** null 이다 — 그 칸은 프리필이
 * 없는 평범한 입력칸이다.
 *
 * 명단에 값이 없는 조사 대상(와 초대 링크 없이 들어온 응답자)은 치환 결과가 빈 문자열이다.
 * 그 칸을 빈 채로 잠그면 응답자는 적을 수도 없고, 필수 칸이면 넘어갈 수도 없다. 그래서
 * 잠금은 "템플릿이 걸렸는가"가 아니라 "명단에서 값이 왔는가"로 정한다(2026-10-13).
 * 공백만 남는 결과(`{{a}} {{b}}` 가 둘 다 빈 경우)도 빈 것으로 본다.
 */
export function resolveTokenPrefill(
  template: string | null | undefined,
  attrs: PrefillAttrs,
): string | null {
  if (!template || template.trim().length === 0) return null;
  const value = substituteTokens(template, (attrs ?? {}) as Record<string, string>);
  return value.trim().length > 0 ? value : null;
}

/**
 * 표 input 셀의 잠금 템플릿 — 「응답자가 고칠 수 있게」(`prefillEditable`)를 켠 셀은 잠그지 않는다.
 * 그 셀의 템플릿은 처음 한 번 깔리는 초기값일 뿐이라, 잠긴 칸에 주는 면제(형식·품질 검사,
 * 형식 정돈)를 받지 않는다.
 */
export function cellLockTemplate(cell: {
  defaultValueTemplate?: string | null | undefined;
  prefillEditable?: boolean | undefined;
}): string | null {
  return cell.prefillEditable === true ? null : (cell.defaultValueTemplate ?? null);
}

/**
 * 토큰 프리필로 잠긴 칸인가. 렌더러가 `disabled` 로 그리는 판정과 같은 식이다
 * (`question-input.tsx` · `question-renderer/cells/input-cell.tsx`).
 *
 * 잠긴 칸은 차단 검증 대상이 아니다 — 응답자가 고칠 수 없는 값(명단에서 온 외국 번호 등)으로
 * 진행을 막으면 따를 수 있는 길이 없다. 형식 검사·응답 품질 검사·이월 면제가 모두 같은
 * 원칙을 쓴다. 값이 유효하면 저장 경계가 정규형으로 정돈한다(`normalizeFormatValues`).
 * 명단 값이 비어 잠기지 않은 칸은 응답자가 직접 적으므로 평범한 칸과 같이 검사한다.
 *
 * `attrs` 는 생략할 수 없다 — 빠뜨리면 잠긴 칸이 전부 안 잠긴 것으로 판정돼, 응답자가
 * 고칠 수 없는 값에 차단 검증이 걸린다.
 *
 * 문항 레벨(`numeric-validation`·`format-normalize`)과 셀 레벨(`cell-text-quality`)이 함께
 * 부르므로 사슬 최하단인 renderer/utils 가 소유한다 (AGENTS.md "src/lib 잔류 기준").
 */
export function isTokenPrefilled(
  template: string | null | undefined,
  attrs: PrefillAttrs,
): boolean {
  return resolveTokenPrefill(template, attrs) !== null;
}
