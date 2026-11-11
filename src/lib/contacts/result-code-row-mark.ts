import type { ContactResultCode, ResultCodeRowMark } from '@/shared/contracts/contacts';
import { resolveCodeStatus } from '@/lib/contacts/result-code-statuses-normalize';
import { isUnsubscribeResultCode } from '@/lib/operations/filter-shared';

/**
 * 조사 대상 목록의 행 표시 (CONTEXT.md 「행 표시」).
 *
 * 목록을 훑는 실사 담당자가 「더 볼 필요 없는 대상」을 색으로 걸러 보게 한다 —
 * 끝난 대상(온라인 응답완료 또는 조사완료 코드)은 파란 음영, 빠지는 대상(수신거부·조사대상아님)은 붉은 음영.
 * 화면 표시만 정하는 순수 모듈이다 — 응답률·단체 메일 제외(결과코드 `status`·수신거부 축)는 건드리지 않는다.
 * 결과코드 설정 화면(선택 상자의 지금 값)과 목록 표가 같은 함수를 쓴다.
 */

export const RESULT_CODE_ROW_MARKS: readonly ResultCodeRowMark[] = ['none', 'done', 'out'];

export function isResultCodeRowMark(value: unknown): value is ResultCodeRowMark {
  return (RESULT_CODE_ROW_MARKS as readonly unknown[]).includes(value);
}

/** 「조사 대상 아님」류 — 띄어쓰기를 무시하고 본다(코드 글자는 담당자가 자유롭게 적는다). */
function isNotTargetCode(code: string): boolean {
  return code.replace(/\s+/g, '').includes('조사대상아님');
}

/**
 * 결과코드 하나의 행 표시 — 설정에서 고른 값이 우선이고, 고르지 않았으면 코드에서 읽는다.
 * 긍정 상태(응답 완료로 인정하는 코드) → 끝난 대상, 수신거부·조사대상아님 → 빠지는 대상, 그 외 없음.
 * 고르지 않은 설문도 곧바로 색이 붙도록 둔 기본값이고, 설정에서 「없음」을 고르면 꺼진다.
 */
export function resolveCodeRowMark(code: ContactResultCode): ResultCodeRowMark {
  if (isResultCodeRowMark(code.rowMark)) return code.rowMark;
  if (isUnsubscribeResultCode(code.code) || isNotTargetCode(code.code)) return 'out';
  return resolveCodeStatus(code) === 'positive' ? 'done' : 'none';
}

/**
 * 조사 대상 한 명의 행 표시.
 * 빠지는 대상이 끝난 대상을 이긴다 — 응답을 마쳤더라도 조사 대상이 아니라고 적은 대상은 빠지는 쪽으로 보인다.
 * 마지막 컨택결과가 지금 결과코드 목록에 없으면(지워진 옛 코드) 코드 글자만으로 기본값을 읽는다.
 */
export function resolveContactRowMark(
  row: { responded: boolean; latestResultCode: string | null },
  codes: readonly ContactResultCode[],
): ResultCodeRowMark {
  const latest = row.latestResultCode;
  const codeMark =
    latest == null
      ? 'none'
      : resolveCodeRowMark(
          codes.find((c) => c.code === latest) ?? { code: latest, label: latest, order: 0 },
        );
  if (codeMark === 'out') return 'out';
  return row.responded || codeMark === 'done' ? 'done' : 'none';
}
