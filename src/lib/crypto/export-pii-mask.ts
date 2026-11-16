import type { Question } from '@/types/survey';

import { maskHint } from './mask-hint';
import { type PiiFieldType, isPiiFieldType } from './pii-fields';

/**
 * 게스트 계정이 내려받는 파일의 개인정보 가리기 (2026-11-16).
 *
 * 내보내기는 관리자에게 평문을 준다. 게스트(내려받기를 허용한 보기 전용 grant)에게는 같은 파일에서
 * **개인정보로 표시된 값만** 가려서 준다 — 응답의 암호화 표시(`piiEncrypted`) 문항·칸과 명단의
 * 개인정보 열. 표시가 없는 값(부서·기업명·사업자번호·서술형 답)은 가릴 근거가 없어 그대로 나간다.
 *
 * 규칙은 조사 대상 목록이 쓰는 마스킹 힌트(`maskHint`)를 그대로 쓴다. 둘만 여기서 정한다 —
 * **성명(명단의 성명·대표자 열, 형식 없는 응답 칸)은 마지막 글자 하나만 가린다**(`홍길동` → `홍길*`,
 * 사용자 결정 — 화면의 `홍**` 과 다르다), 종류를 모르는 글자도 같은 규칙이다.
 *
 * 가리기는 내보내는 값에만 건다. 숨은 문항 판정·계산 같은 서버 재평가는 평문으로 끝낸 뒤다.
 */

/** 내려받는 파일에서 마지막 글자만 가리는 종류 — 화면의 마스킹 힌트(`김**`)를 쓰지 않는다. */
const NAME_TYPES: ReadonlySet<PiiFieldType> = new Set(['name', 'representative']);

/** 성명과 종류를 모르는 글자 — 마지막 글자 하나만 가린다. */
function maskLastChar(value: string): string {
  const chars = [...value];
  return `${chars.slice(0, -1).join('')}*`;
}

/**
 * 답 하나를 가린다. `format` 은 그 칸의 입력 형식 또는 명단 열의 개인정보 종류 — 마스킹 힌트가 아는
 * 종류(이메일·전화·휴대전화·사업자번호·성명·주소 등)면 그 규칙을, 모르거나 값이 그 형식이 아니면
 * 마지막 글자 가리기를 쓴다. 빈 값은 그대로 둔다.
 */
export function maskExportValue(value: string, format: string | undefined): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (format && isPiiFieldType(format) && !NAME_TYPES.has(format)) {
    const hint = maskHint(format, trimmed);
    if (hint) return hint;
  }
  return maskLastChar(trimmed);
}

/** 개인정보로 표시된 답의 자리와 그 입력 형식 — 문항 단위(단답·장문)와 표 입력 칸 단위. */
export interface PiiAnswerFormats {
  questions: ReadonlyMap<string, string | undefined>;
  cells: ReadonlyMap<string, ReadonlyMap<string, string | undefined>>;
}

/** 설문 구조에서 개인정보 표시(`piiEncrypted`)가 붙은 문항·표 입력 칸을 모은다(저장 암호화와 같은 대상). */
export function collectPiiAnswerFormats(questions: readonly Question[]): PiiAnswerFormats {
  const questionFormats = new Map<string, string | undefined>();
  const cellFormats = new Map<string, Map<string, string | undefined>>();
  for (const q of questions) {
    if (q.piiEncrypted === true) questionFormats.set(q.id, q.inputType);
    for (const row of q.tableRowsData ?? []) {
      for (const cell of row.cells ?? []) {
        if (cell.type !== 'input' || cell.piiEncrypted !== true) continue;
        const byCell = cellFormats.get(q.id) ?? new Map<string, string | undefined>();
        byCell.set(cell.id, cell.inputType);
        cellFormats.set(q.id, byCell);
      }
    }
  }
  return { questions: questionFormats, cells: cellFormats };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 응답 한 건의 답에서 개인정보로 표시된 자리만 가린 새 객체 (원본 불변). 대상이 없으면 원본 그대로. */
export function maskPiiAnswers(
  responses: Record<string, unknown>,
  formats: PiiAnswerFormats,
): Record<string, unknown> {
  if (formats.questions.size === 0 && formats.cells.size === 0) return responses;
  const out: Record<string, unknown> = { ...responses };
  for (const [questionId, format] of formats.questions) {
    const value = out[questionId];
    if (typeof value === 'string') out[questionId] = maskExportValue(value, format);
  }
  for (const [questionId, byCell] of formats.cells) {
    const value = out[questionId];
    if (!isPlainObject(value)) continue;
    const masked: Record<string, unknown> = { ...value };
    for (const [cellId, format] of byCell) {
      const cellValue = masked[cellId];
      if (typeof cellValue === 'string') masked[cellId] = maskExportValue(cellValue, format);
    }
    out[questionId] = masked;
  }
  return out;
}

/**
 * 명단 값 한 행에서 개인정보 열만 가린다. `piiTypeBySource` 는 열 key(`pii.성명`) → 개인정보 종류 —
 * 여기 있는 열만 건드린다(일반 열은 그대로). 종류가 비어 있으면 마지막 글자 가리기.
 */
export function maskContactPiiValues(
  values: Readonly<Record<string, string>>,
  piiTypeBySource: ReadonlyMap<string, PiiFieldType | undefined>,
): Record<string, string> {
  const out: Record<string, string> = { ...values };
  for (const [source, piiType] of piiTypeBySource) {
    const value = out[source];
    if (typeof value === 'string') out[source] = maskExportValue(value, piiType);
  }
  return out;
}
