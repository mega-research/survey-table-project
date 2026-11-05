/**
 * 고친 프리필 판정 — 「고친 경우만 따로 내보내기」(`TableCell.exportPrefillEdit`)를 켠 고칠 수 있는 프리필 칸 중,
 * 응답자가 낸 값이 그 응답자의 명단 값(템플릿을 응답 화면과 같은 규칙으로 푼 값)과 다른 칸을 모은다.
 * 응답 확정이 이 결과로 사이드카 `__prefillEdits__` 를 덮어쓰고, 내보내기 `<변수>_upd` 열이 그것을 읽는다.
 *
 * 값이 비어 있으면 고친 것으로 보지 않는다(`_upd` 에 실을 값이 없다). 비교는 앞뒤 공백을 걷은 글자다.
 */
import type { Question } from '@/types/survey';
import type { PrefillEdits } from '@/utils/prefill-edits-sidecar';

import { substituteTokens } from './substitute-tokens';

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
        const roster = substituteTokens(template, attrs, {}).trim();
        if (value.trim() !== roster) edited.push(cell.id);
      }
    }
    if (edited.length > 0) out[q.id] = edited;
  }
  return out;
}
