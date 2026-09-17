import type { Question } from '@/types/survey';

/**
 * order 기준 정렬 후 SPSS 변수명을 할당한다.
 * - notice 타입: 변수명 제외 (순번에서도 제외)
 * - isCustomSpssVarName이 true: 기존 questionCode 보존
 * - 나머지: Q1, Q2, Q3... 대문자 자동 생성
 */
function assignVarNames(questions: Question[]): Question[] {
  const sorted = [...questions].sort((a, b) => a.order - b.order);
  let autoIndex = 1;
  let noticeIndex = 1;

  return sorted.map((q) => {
    if (q.type === 'notice') {
      // requiresAcknowledgment인 notice만 변수명 할당
      if (q.requiresAcknowledgment) {
        if (q.isCustomSpssVarName && q.questionCode) {
          return { ...q };
        }
        const varName = `N${noticeIndex}`;
        noticeIndex++;
        return { ...q, questionCode: varName };
      }
      const { questionCode: _qc, ...qWithout } = q;
      return qWithout as Question;
    }

    if (q.isCustomSpssVarName && q.questionCode) {
      return { ...q };
    }

    const varName = `Q${autoIndex}`;
    autoIndex++;
    return { ...q, questionCode: varName };
  });
}

/** 질문 목록에 SPSS 변수명을 자동 생성하여 반환한다. */
export function generateSpssVarNames(questions: Question[]): Question[] {
  return assignVarNames(questions);
}

/** 질문 순서 변경 후 자동 변수명을 재할당한다. */
export function regenerateAfterReorder(questions: Question[]): Question[] {
  return assignVarNames(questions);
}

/** 질문 삭제 후 빈 번호 없이 연속 순번으로 재할당한다. */
export function regenerateAfterDelete(questions: Question[]): Question[] {
  return assignVarNames(questions);
}
