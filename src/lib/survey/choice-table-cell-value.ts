/**
 * 보기-소스 표(choice_opt 로 그려지는 radio/checkbox 문항) 안의 선택형 셀 값 규약.
 *
 * 그 표를 그리는 문항은 `table` 이 아니라 `radio`/`checkbox` 라 응답이 `{그룹키: 셀id}`
 * 모양이고, 셀 id 를 키로 하는 자리가 없다. 그래서 값은 단답형 셀과 같은 `__optTexts__`
 * 사이드카에 **셀 id** 로 넣는다.
 *
 * 렌더(choice-table-cell-control)·검증(numeric-validation)·내보내기가 같은 인코딩을
 * 봐야 하므로 규약은 여기 한 곳에 둔다. 이 모듈은 서버 경계를 지나므로 순수하게 유지한다
 * (React import 금지 — lib 이 컴포넌트를 끌어오면 빌드에서만 터진다).
 */

/** 보기-소스 표 안에서 인터랙티브로 그리는 선택형 셀 타입. */
export const CHOICE_TABLE_CONTROL_CELL_TYPES: ReadonlySet<string> = new Set([
  'radio',
  'checkbox',
  'select',
]);

/**
 * 사이드카는 문자열 한 칸이라 복수 선택은 JSON 배열로 적는다.
 * 구분자로 잇지 않는 이유: 옵션 값은 담당자가 코딩북에 맞춰 자유롭게 적는 문자열이라
 * 어떤 구분자도 값 안에 들어올 수 있다.
 */
export function encodeChoiceTableCellValue(value: string | string[] | object): string {
  if (Array.isArray(value)) {
    const kept = value.filter((v): v is string => typeof v === 'string' && v !== '');
    return kept.length > 0 ? JSON.stringify(kept) : '';
  }
  return typeof value === 'string' ? value : '';
}

export function decodeChoiceTableCellValue(raw: string, cellType: string): string | string[] {
  if (cellType !== 'checkbox') return raw;
  if (raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    // 예전 단일 문자열 값 — 한 개짜리 선택으로 읽는다.
  }
  return [raw];
}

/** 미응답 판정 — checkbox 는 빈 배열, 나머지는 빈 문자열. */
export function isChoiceTableCellEmpty(raw: string, cellType: string): boolean {
  const picked = decodeChoiceTableCellValue(raw.trim(), cellType);
  return Array.isArray(picked) ? picked.length === 0 : picked === '';
}

/**
 * Raw 내보내기에서 복수 선택을 한 칸에 실을 때 쓰는 구분자.
 * 사이드카 저장(JSON 배열)과 달리 사람이 읽는 칸이라 콤마로 잇는다.
 */
export const CHOICE_TABLE_EXPORT_SEPARATOR = ',';

/** 내보내기 칸 → 사이드카 저장 문자열. Raw 되읽기(이월 응답 임포트)가 쓴다. */
export function encodeChoiceTableCellFromExport(raw: string, cellType: string): string {
  if (cellType !== 'checkbox') return raw;
  const parts = raw
    .split(CHOICE_TABLE_EXPORT_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return parts.length > 0 ? JSON.stringify(parts) : '';
}
