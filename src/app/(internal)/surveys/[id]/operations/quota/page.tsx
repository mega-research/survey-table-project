import type { Metadata } from 'next';

import { QuotaEditor } from '@/features/operations/quota/quota-editor';
import { getOperationsDataScope } from '@/server/data-scope';
import { getContactColumnScheme } from '@/server/read-models/contacts';
import { getQuestionsBySurvey, getSurveyById } from '@/server/read-models/survey-structure';
import { getQuotaConfig } from '@/server/quota/services/quota';
import type { InputType, Question } from '@/types/survey';
import { requireAdminPage } from '@/lib/auth/require-admin-page';
import { assertSurveyCapabilityPage } from '@/server/page-survey-access';

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
  // 게스트 차단 화면 — admin 레이아웃의 경로 가드는 소프트 내비게이션에서 재실행되지 않으므로
  // 페이지가 스스로 막는다(페이지는 내비게이션마다 반드시 다시 렌더된다). 설문 단위
  // capability 관문(operations.view)은 거부 사유 불문 notFound 로 접는다 (티켓 10).
  const viewer = await requireAdminPage();
  const { id: surveyId } = await params;
  await assertSurveyCapabilityPage(viewer, surveyId, 'operations.view');
  const scope = await getOperationsDataScope(surveyId);
  const [config, questionRows, scheme, survey] = await Promise.all([
    getQuotaConfig(surveyId),
    getQuestionsBySurvey(surveyId),
    getContactColumnScheme(surveyId, scope),
    getSurveyById(surveyId),
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
