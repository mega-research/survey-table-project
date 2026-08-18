import { describe, it, expect } from 'vitest';

import {
  EXPORT_ROW_EXCLUSIONS,
  applyExportRowExclusions,
} from '@/lib/analytics/export-exclusions';
import type { QuestionVariant } from '@/lib/question';
import type { TableRow } from '@/types/survey';

// 제외 목록에 등재된 실제 대상 설문 (게임 장르 콘텐츠가치평가 기초조사)
const TARGET_SURVEY_ID = Object.keys(EXPORT_ROW_EXCLUSIONS)[0]!;

function makeRow(rowCode: string, withDisplayCondition = false): TableRow {
  return {
    id: `row-${rowCode}`,
    label: `라벨 ${rowCode}`,
    rowCode,
    cells: [],
    ...(withDisplayCondition
      ? { displayCondition: { logicType: 'AND', conditions: [] } }
      : {}),
  } as unknown as TableRow;
}

function makeTableQuestion(questionCode: string, rows: TableRow[]): QuestionVariant {
  return {
    id: `q-${questionCode}`,
    type: 'table',
    title: questionCode,
    questionCode,
    tableColumns: [],
    tableRowsData: rows,
  } as unknown as QuestionVariant;
}

describe('applyExportRowExclusions', () => {
  it('대상 설문의 Q3_2에서 제외 rowCode 행만 제거하고 나머지 행 순서를 보존한다', () => {
    const question = makeTableQuestion('Q3_2', [
      makeRow('r10'),
      makeRow('r11'),
      makeRow('r12'),
      makeRow('r13'),
      makeRow('r14'),
      makeRow('r15'),
      makeRow('r17'),
      makeRow('r16'),
    ]);

    const [result] = applyExportRowExclusions(TARGET_SURVEY_ID, [question]);

    const rowCodes = (result as { tableRowsData?: TableRow[] }).tableRowsData?.map(
      (r) => r.rowCode,
    );
    expect(rowCodes).toEqual(['r10', 'r17', 'r16']);
  });

  it('대문자 UUID로 요청해도 동일하게 제외한다', () => {
    // Postgres UUID 조회는 대소문자 무관하므로, URL에 대문자 UUID를 넣으면 설문은
    // 조회되면서 제외 목록만 비켜가는 우회가 가능했다 — 정규화로 차단 (Codex 리뷰)
    const question = makeTableQuestion('Q3_2', [makeRow('r10'), makeRow('r11')]);

    const [result] = applyExportRowExclusions(TARGET_SURVEY_ID.toUpperCase(), [question]);

    const rowCodes = (result as { tableRowsData?: TableRow[] }).tableRowsData?.map(
      (r) => r.rowCode,
    );
    expect(rowCodes).toEqual(['r10']);
  });

  it('대상 설문이라도 제외 목록에 없는 questionCode는 손대지 않는다', () => {
    // Q3_1(모바일)은 같은 rowCode r11~r15 를 갖지만 제외 대상이 아님
    const question = makeTableQuestion('Q3_1', [makeRow('r10'), makeRow('r11'), makeRow('r15')]);

    const [result] = applyExportRowExclusions(TARGET_SURVEY_ID, [question]);

    expect(result).toBe(question);
  });

  it('다른 설문은 questionCode·rowCode가 겹쳐도 원본 그대로 반환한다', () => {
    const questions = [makeTableQuestion('Q3_2', [makeRow('r11'), makeRow('r12')])];

    const result = applyExportRowExclusions('00000000-0000-0000-0000-000000000000', questions);

    expect(result).toBe(questions);
  });

  it('displayCondition이 있는 행이라도 제외 목록에 없으면 유지한다', () => {
    // 제외 판정은 rowCode 목록만 본다 — displayCondition 존재 여부는 무관
    const question = makeTableQuestion('Q3_3', [
      makeRow('r05', true),
      makeRow('r11', true),
    ]);

    const [result] = applyExportRowExclusions(TARGET_SURVEY_ID, [question]);

    const rowCodes = (result as { tableRowsData?: TableRow[] }).tableRowsData?.map(
      (r) => r.rowCode,
    );
    expect(rowCodes).toEqual(['r05']);
  });
});
