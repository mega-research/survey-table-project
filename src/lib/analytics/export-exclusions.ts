import type { QuestionVariant } from '@/lib/question';

/**
 * [일회성 예외 — 납품 후 이 파일과 호출 2곳을 제거할 것]
 *
 * '게임 장르 콘텐츠가치평가 모형 개발을 위한 기초조사' 설문에서 실수로 추가됐다가
 * displayCondition 으로 숨김 처리된 행(eCPM/CPI/CVR/LTV/광고 제거 매출 비중)을
 * RawData·SPSS export 에서만 제외한다. DB 데이터는 그대로 유지된다.
 *
 * 제외 판정은 아래 하드코딩 목록(surveyId → questionCode → rowCode)만 사용하며
 * displayCondition 존재 여부는 일절 참조하지 않는다 — 다른 설문/문항에 영향 없음.
 */
export const EXPORT_ROW_EXCLUSIONS: Record<string, Record<string, readonly string[]>> = {
  '6d9adc1c-d559-44d0-a51e-ce2662fd131f': {
    Q3_2: ['r11', 'r12', 'r13', 'r14', 'r15'],
    Q3_3: ['r11', 'r12', 'r13', 'r14', 'r15'],
  },
};

/** 제외 목록에 걸린 행만 tableRowsData 에서 제거한 사본을 반환한다 (그 외는 원본 참조 유지). */
export function applyExportRowExclusions(
  surveyId: string,
  questions: QuestionVariant[],
): QuestionVariant[] {
  const surveyExclusions = EXPORT_ROW_EXCLUSIONS[surveyId];
  if (!surveyExclusions) return questions;

  return questions.map((question) => {
    if (question.type !== 'table' || !question.questionCode || !question.tableRowsData) {
      return question;
    }
    const excludedRowCodes = surveyExclusions[question.questionCode];
    if (!excludedRowCodes) return question;

    return {
      ...question,
      tableRowsData: question.tableRowsData.filter(
        (row) => !row.rowCode || !excludedRowCodes.includes(row.rowCode),
      ),
    };
  });
}
