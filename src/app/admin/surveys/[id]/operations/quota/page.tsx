import { requireAdminPage } from '@/lib/auth/require-admin-page';
import type { Metadata } from 'next';

import { CompletionTargetCard } from '@/features/operations/quota/completion-target-card';
import { QuotaEditor } from '@/features/operations/quota/quota-editor';
import { getOperationsDataScope } from '@/server/data-scope';
import { getContactColumnScheme } from '@/server/read-models/contacts';
import { getQuestionsBySurvey, getSurveyById } from '@/server/read-models/survey-structure';
import { getQuotaConfig } from '@/server/quota/services/quota';
import { countCompletedResponses } from '@/server/survey-response/services/response-gate';
import type { InputType, Question } from '@/types/survey';

export const metadata: Metadata = {
  title: '현황 - 쿼터 설정',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * `getQuestionsBySurvey` 는 questions 테이블 raw row(널러블 컬럼 다수)를 반환하며
 * `@/types/survey`의 `Question`(옵셔널 필드)과 구조적으로 다르다 — DB 컬럼은
 * nullable(`string | null`)인 반면 Question 은 optional(`string | undefined`)이라
 * strict + exactOptionalPropertyTypes 하에서 그대로 대입 불가.
 * QuotaEditor 가 실제로 읽는 필드만 null-coalescing 으로 옮긴다
 * (server/survey-builder/services/survey-read.ts `getSurveyWithDetails` 의 매핑 관행과 동일 — `as unknown as` 금지).
 */
function toQuestion(row: Awaited<ReturnType<typeof getQuestionsBySurvey>>[number]): Question {
  return {
    id: row.id,
    type: row.type as Question['type'],
    title: row.title,
    required: row.required,
    order: row.order,
    ...(row.options != null ? { options: row.options as NonNullable<Question['options']> } : {}),
    ...(row.tableRowsData != null
      ? { tableRowsData: row.tableRowsData as NonNullable<Question['tableRowsData']> }
      : {}),
    ...((row.inputType as InputType | null) != null
      ? { inputType: row.inputType as InputType }
      : {}),
  };
}

export default async function QuotaPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  // 관리자 전용 화면 — 미들웨어를 통과한 무권한 세션과 게스트를 거른다.
  await requireAdminPage();
  const scope = await getOperationsDataScope(surveyId);
  const [config, questionRows, scheme, survey, completedCount] = await Promise.all([
    getQuotaConfig(surveyId),
    getQuestionsBySurvey(surveyId),
    getContactColumnScheme(surveyId, scope),
    getSurveyById(surveyId),
    // 전체 완료 목표의 셈 — 응답 게이트가 차단 판정에 쓰는 것과 같은 함수(실응답 완료만).
    // 테스트 데이터를 보는 중이어도 실응답을 센다: 목표는 실응답으로만 닫힌다.
    countCompletedResponses(surveyId),
  ]);
  const questions = questionRows.map(toQuestion);
  // 속성형 조건의 소스 후보 — attrs 열만. pii 는 암호문이라 매칭할 수 없고 system 은 명단 값이 아니다.
  const attrColumns = (scheme?.columns ?? [])
    .filter((c) => c.source.startsWith('attrs.'))
    .map((c) => ({ key: c.source.slice('attrs.'.length), label: c.label }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">쿼터 설정</h2>
        <p className="text-sm text-slate-600">
          차원(문항·조사 대상 속성)을 고르고 셀별 목표를 정하면, 완료 수가 목표에 도달한 셀은 자동 마감됩니다.
        </p>
      </div>
      <div className="mb-4">
        {/* key — 다른 관리자가 바꾼 목표가 새로 고침으로 내려오면 카드가 그 값으로 다시 선다 */}
        <CompletionTargetCard
          key={survey?.maxResponses ?? 'none'}
          surveyId={surveyId}
          initialTarget={survey?.maxResponses ?? null}
          completedCount={completedCount}
        />
      </div>
      <QuotaEditor
        surveyId={surveyId}
        initialConfig={config}
        questions={questions}
        attrColumns={attrColumns}
        requireInviteToken={survey?.requireInviteToken ?? false}
      />
    </main>
  );
}
