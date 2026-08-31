import 'server-only';

import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';

import { db } from '@/db';
import { surveyResponses, surveyVersions, surveys } from '@/db/schema';
import { notDeletedResponse } from '@/data/response-filters';
import { normalizeQuestions } from '@/lib/question';
import type { Question, QuestionGroup } from '@/types/survey';

import { buildDemandSummary, type DemandSummaryRow } from './demand-summary';
import { responseScopeCondition, type OperationsDataScope } from './data-scope.server';

/**
 * 문항 수요조사 집계 — SQL 부. 순수 계산은 접미사 없는 파일(demand-summary.ts)이 갖는다.
 *
 * - 문항 목록은 **발행 스냅샷**에서 읽는다. 응답이 그 구조로 들어왔기 때문이다.
 *   미발행 설문은 집계할 것이 없다.
 * - 응답은 완료분만, 그리고 **운영 데이터 스코프**(실/테스트 파티션)를 반드시 태운다.
 * - 통계 기준은 `question_responses` JSONB 원본이다 — 정규화 응답 테이블이 아니다
 *   (그 테이블은 saveResponse/saveAdminEdit 에서만 채워진다).
 */
export async function getDemandSummary(
  surveyId: string,
  scope: OperationsDataScope,
): Promise<DemandSummaryRow[]> {
  const [surveyRow] = await db
    .select({ currentVersionId: surveys.currentVersionId })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);
  if (!surveyRow?.currentVersionId) return [];

  const [versionRow] = await db
    .select({ snapshot: surveyVersions.snapshot })
    .from(surveyVersions)
    .where(eq(surveyVersions.id, surveyRow.currentVersionId))
    .limit(1);

  const snapshot = versionRow?.snapshot;
  if (!snapshot) return [];

  // 스냅샷 읽기 경계 — 세대별 키셋이 다른 질문을 보존 모드 정규화로 수렴시킨다.
  const questions = normalizeQuestions(snapshot.questions) as Question[];
  const groups = (snapshot.groups ?? []) as QuestionGroup[];

  const responses = await db
    .select()
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.isCompleted, true),
        notDeletedResponse,
        responseScopeCondition(scope),
      ),
    );

  return buildDemandSummary(questions, groups, responses);
}


/**
 * 집계표를 엑셀 워크북으로. **화면에 보이는 표와 같은 내용**이다 —
 * 3지선다가 아닌 문항의 비율 칸도 화면과 같이 비워 둔다(0 으로 채우지 않는다).
 * 의견은 전문을 한 칸에 줄바꿈으로 넣는다 — 받자마자 기획서에 붙일 수 있어야 한다.
 *
 * 기존 SPSS/엑셀 원자료 export 는 손대지 않는다. 이건 그 옆에 하나를 더하는 일이다.
 */
export function buildDemandSummaryWorkbook(rows: readonly DemandSummaryRow[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('문항 수요');

  const header = sheet.addRow(['그룹', '문항코드', '문항', '필요', '불필요', '필요율(%)', '의견 수', '의견']);
  header.font = { bold: true };

  for (const row of rows) {
    sheet.addRow([
      row.groupName ?? '',
      row.questionCode ?? '',
      row.title,
      row.needCount ?? '',
      row.dropCount ?? '',
      row.needRate === null ? '' : Number(row.needRate.toFixed(1)),
      row.opinionCount,
      row.opinions.join('\n'),
    ]);
  }

  sheet.columns = [
    { width: 18 },
    { width: 12 },
    { width: 48 },
    { width: 8 },
    { width: 10 },
    { width: 12 },
    { width: 10 },
    { width: 60 },
  ];
  sheet.getColumn(8).alignment = { wrapText: true, vertical: 'top' };
  return workbook;
}
