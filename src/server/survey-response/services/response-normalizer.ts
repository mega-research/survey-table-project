/**
 * 응답 정규화 유틸리티
 *
 * JSONB questionResponses → response_answers 행으로 변환
 */

interface QuestionMeta {
  id: string;
  type: string;
}

interface NormalizedAnswer {
  responseId: string;
  questionId: string;
  textValue: string | null;
  arrayValue: string[] | null;
  objectValue: Record<string, unknown> | null;
  questionType: string;
}

/**
 * JSONB 응답 데이터를 정규화된 행 배열로 변환
 *
 * - string → textValue
 * - string[] → arrayValue
 * - object → objectValue (table, multiselect, other 응답)
 * - null/undefined → 건너뜀
 * - 질문 목록에 없는 ID → 건너뜀
 */
export function normalizeToAnswers(
  responseId: string,
  questionResponses: Record<string, unknown>,
  questions: QuestionMeta[],
): NormalizedAnswer[] {
  const questionMap = new Map(questions.map((q) => [q.id, q.type]));
  const answers: NormalizedAnswer[] = [];

  for (const [questionId, value] of Object.entries(questionResponses)) {
    if (value === null || value === undefined) continue;

    const questionType = questionMap.get(questionId);
    if (!questionType) continue;

    const answer: NormalizedAnswer = {
      responseId,
      questionId,
      textValue: null,
      arrayValue: null,
      objectValue: null,
      questionType,
    };

    if (typeof value === 'string') {
      answer.textValue = value;
    } else if (Array.isArray(value)) {
      // 배열 원소에 객체가 하나라도 섞여 있으면 (ranking 응답, checkbox+기타 응답 등)
      // String() 변환 시 "[object Object]" 손실이 발생하므로 objectValue 컨테이너에 래핑 저장.
      // response-adapter 에서 __array 키를 복원하여 원본 배열 shape 유지.
      const hasObjectItem = value.some((v) => v !== null && typeof v === 'object');
      if (hasObjectItem) {
        answer.objectValue = { __array: value as unknown[] } as Record<string, unknown>;
      } else {
        answer.arrayValue = value.map(String);
      }
    } else if (typeof value === 'object') {
      answer.objectValue = value as Record<string, unknown>;
    }

    answers.push(answer);
  }

  return answers;
}
