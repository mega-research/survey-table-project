/**
 * 저장 경계의 입력 형식 정규화 — 제출 페이로드의 형식 지정 값을 정규형으로 정돈한다.
 *
 * 화면은 blur 시 정돈하지만 그것만으로는 모자란다. "다음"/제출 핸들러는 iOS 대응으로
 * 클릭 안에서 스스로 `activeElement.blur()` 를 부르는데, 그 blur 가 예약한 React 상태
 * 갱신은 **같은 클릭 안에서 커밋되지 않는다**. 포커스를 쥔 채 제출하면 화면은 나중에
 * 정돈돼도 페이로드에는 비정규 원문이 실린다(실제로 재현했다).
 *
 * 그래서 저장 경계가 스스로 한 번 더 정돈한다. 판정 규칙은 화면(`useInputFormatField`)·
 * 차단 검증(`numeric-validation`)과 **같다** — 갈라지면 화면과 저장이 어긋난다.
 * - 형식에 맞지 않는 값은 손대지 않는다(차단이 이미 막았거나, 관리자 편집처럼 통과가 허용된 값이다)
 * - 이월 원본 그대로인 값은 손대지 않는다(응답자가 치지 않은 값이다)
 * - 토큰 프리필로 잠긴 칸은 손대지 않는다(화면에 보이는 값과 저장값이 갈라지면 안 된다)
 */
import { isInputFormat } from '@/types/input-type';
import type { Question, TableCell } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { parseInputFormat } from '@/utils/input-format';

import {
  type PriorAnswers,
  isUntouchedPriorValue,
  priorAnswerText,
  priorOptionText,
} from './prior-answers';
import { OPT_TEXTS_KEY } from './response-sidecars';

/** 한 칸의 형식 정돈 — 대상이 아니거나 형식이 틀리면 원문 그대로. */
function normalizeOne(
  value: unknown,
  inputType: Question['inputType'] | undefined,
  defaultValueTemplate: string | null | undefined,
  priorOriginal: string | null,
): unknown {
  if (!isInputFormat(inputType)) return value;
  if (typeof value !== 'string') return value;
  if ((defaultValueTemplate ?? '').trim().length > 0) return value;
  if (isUntouchedPriorValue(value, priorOriginal)) return value;
  const result = parseInputFormat(inputType, value);
  return result.ok && result.normalized !== '' ? result.normalized : value;
}

function flatCellsOf(question: Question): TableCell[] {
  return (question.tableRowsData ?? []).flatMap((row) => row.cells);
}

/**
 * 제출 페이로드(`questionResponses` + `__optTexts__` 사이드카)를 정돈한 새 객체로 낸다.
 * 바뀐 값이 하나도 없으면 입력 객체를 그대로 돌려준다(불필요한 참조 변경 방지).
 */
export function normalizeFormatValues(
  questions: readonly Question[],
  payload: Record<string, unknown>,
  priorAnswers?: PriorAnswers | null,
): Record<string, unknown> {
  let changed = false;
  const next: Record<string, unknown> = { ...payload };
  const sidecar = payload[OPT_TEXTS_KEY];
  const nextSidecar: Record<string, Record<string, string>> = sidecar &&
  typeof sidecar === 'object' &&
  !Array.isArray(sidecar)
    ? { ...(sidecar as Record<string, Record<string, string>>) }
    : {};

  for (const question of questions) {
    // 단답형 — 응답값이 문항 키에 그대로 있다.
    if (question.type === 'text') {
      const normalized = normalizeOne(
        next[question.id],
        question.inputType,
        question.defaultValueTemplate,
        priorAnswerText(priorAnswers, question.id),
      );
      if (normalized !== next[question.id]) {
        next[question.id] = normalized;
        changed = true;
      }
      continue;
    }

    // 표 문항 — 셀 값이 문항 키 아래 평면 객체다.
    if (question.type === 'table') {
      const cellValues = next[question.id];
      if (!cellValues || typeof cellValues !== 'object' || Array.isArray(cellValues)) continue;
      const cells = { ...(cellValues as Record<string, unknown>) };
      let cellChanged = false;
      for (const cell of flatCellsOf(question)) {
        if (cell.type !== 'input') continue;
        const normalized = normalizeOne(
          cells[cell.id],
          cell.inputType,
          cell.defaultValueTemplate,
          priorAnswerText(priorAnswers, question.id, cell.id),
        );
        if (normalized !== cells[cell.id]) {
          cells[cell.id] = normalized;
          cellChanged = true;
        }
      }
      if (cellChanged) {
        next[question.id] = cells;
        changed = true;
      }
      continue;
    }

    // 그 밖의 문항 — 보기 상세기재와 보기-소스 표 입력 셀이 사이드카에 들어 있다.
    const texts = nextSidecar[question.id];
    if (!texts) continue;
    const updated = { ...texts };
    let textChanged = false;
    const applyToId = (
      id: string,
      inputType: Question['inputType'] | undefined,
      template: string | null | undefined,
    ) => {
      const current = updated[id];
      if (typeof current !== 'string') return;
      const normalized = normalizeOne(
        current,
        inputType,
        template,
        priorOptionText(priorAnswers, question.id, id),
      );
      if (typeof normalized === 'string' && normalized !== current) {
        updated[id] = normalized;
        textChanged = true;
      }
    };

    for (const option of resolveChoiceOptions(question)) {
      applyToId(option.id, option.textInputType, undefined);
    }
    for (const cell of flatCellsOf(question)) {
      if (cell.type !== 'input') continue;
      applyToId(cell.id, cell.inputType, cell.defaultValueTemplate);
    }
    if (textChanged) {
      nextSidecar[question.id] = updated;
      changed = true;
    }
  }

  if (!changed) return payload;
  if (Object.keys(nextSidecar).length > 0) next[OPT_TEXTS_KEY] = nextSidecar;
  return next;
}
