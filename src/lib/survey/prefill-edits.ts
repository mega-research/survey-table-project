/**
 * 고친 프리필 판정 — 「고친 경우만 따로 내보내기」(`TableCell.exportPrefillEdit`)를 켠 고칠 수 있는 프리필 칸 중,
 * 응답자가 낸 값이 그 응답자의 명단 값(템플릿을 응답 화면과 같은 규칙으로 푼 값)과 다른 칸을 모은다.
 * 응답 확정이 이 결과로 사이드카 `__prefillEdits__` 를 덮어쓰고, 내보내기 `<변수>_upd` 열이 그것을 읽는다.
 *
 * 값이 비어 있으면 고친 것으로 보지 않는다(`_upd` 에 실을 값이 없다).
 *
 * **비교는 칸 형식의 같은 값 기준이다** — 응답 화면은 제출 직전 형식 칸을 정돈해 보낸다(`normalizeFormatValues`,
 * `0212345678` → `02-1234-5678`). 정돈 함수는 응답 화면 묶음 소유라 서버가 부를 수 없으므로, 정돈이 바꾸지
 * 않는 성분으로 견준다: 번호 형식은 숫자만(`+82` 는 국내 번호로), 날짜는 연·월·일 숫자, 숫자 칸은 쉼표를 뺀 수, 그 밖은 앞뒤 공백을 걷은
 * 글자. 글자 그대로 견주면 손대지 않은 번호까지 「고쳤다」가 된다(2026-11-05 리뷰).
 */
import type { Question, TableCell } from '@/types/survey';
import type { PrefillEdits } from '@/utils/prefill-edits-sidecar';

import { substituteTokens } from './substitute-tokens';

const DIGIT_FORMATS = new Set(['mobile', 'phone', 'biz_number', 'corp_number']);

/** 정돈이 바꾸지 않는 성분 — 같은 값이면 같은 글자가 된다 */
function comparable(value: string, inputType: TableCell['inputType']): string {
  const text = value.trim();
  if (inputType && DIGIT_FORMATS.has(inputType)) {
    const digits = text.replace(/\D/g, '');
    // +82 는 정돈이 국내 번호(010…)로 바꾼다 — 국가번호를 걷고 0 을 붙여 같은 모양으로(대표번호 15xx·16xx·18xx 는 0 없이)
    if (!text.startsWith('+82')) return digits;
    const national = digits.slice(2);
    return national.startsWith('0') || /^1[568]/.test(national) ? national : `0${national}`;
  }
  if (inputType === 'date') {
    const parts = text.split(/\D+/).filter(Boolean);
    if (parts.length === 3) return parts.map((p) => String(Number(p))).join('.');
    // 구분자 없는 8자리(20150301)는 정돈이 2015.03.01 로 바꾼다 — 연·월·일로 나눠 같은 모양으로
    const digits = text.replace(/\D/g, '');
    if (digits.length === 8) return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6)].map((p) => String(Number(p))).join('.');
    return digits;
  }
  if (inputType === 'number') {
    const n = Number(text.replace(/,/g, ''));
    return Number.isFinite(n) && text !== '' ? String(n) : text;
  }
  return text;
}

export function computePrefillEdits(
  questions: readonly Question[],
  responses: Record<string, unknown>,
  contactAttrs: Record<string, string | undefined>,
): PrefillEdits {
  const attrs = Object.fromEntries(
    Object.entries(contactAttrs).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  const out: PrefillEdits = {};
  for (const q of questions) {
    if (q.type !== 'table' || !q.tableRowsData) continue;
    const answer = responses[q.id];
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) continue;
    const values = answer as Record<string, unknown>;
    const edited: string[] = [];
    for (const row of q.tableRowsData) {
      for (const cell of row.cells) {
        if (cell.type !== 'input' || !cell.exportPrefillEdit || !cell.prefillEditable) continue;
        const template = cell.defaultValueTemplate?.trim();
        if (!template) continue;
        const value = values[cell.id];
        if (typeof value !== 'string' || value.trim() === '') continue;
        const roster = substituteTokens(template, attrs, {});
        if (comparable(value, cell.inputType) !== comparable(roster, cell.inputType)) edited.push(cell.id);
      }
    }
    if (edited.length > 0) out[q.id] = edited;
  }
  return out;
}
