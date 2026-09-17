import { notFound } from 'next/navigation';

import { FieldworkHeaderBar } from '@/features/fieldwork-console/fieldwork-header-bar';
import { FieldworkSurveyHeader } from '@/features/fieldwork-console/fieldwork-survey-header';
import { assertFieldworkSurveyPageAccess } from '@/server/page-fieldwork-access';
import {
  getFieldworkOrgName,
  getFieldworkSurveyHeader,
} from '@/server/read-models/fieldwork-surveys';
import { loadAccessSubject } from '@/server/survey-access';

interface Props {
  params: Promise<{ surveyId: string }>;
  children: React.ReactNode;
}

/**
 * 실사 열람 화면의 헤더바 + 서브헤더 + 탭 (.pen FLOW 10-2, 역할 모델 v2 티켓 26).
 *
 * 레이아웃이 설문 관문을 한 번 지나고 각 페이지가 자기 관문을 다시 갖는다 — App Router 는
 * 소프트 내비게이션에서 상위 레이아웃을 다시 돌리지 않으므로, 레이아웃만 믿으면 세션이
 * 폐기된 뒤에도 데이터를 읽는다(AGENTS 「RSC 페이지는 자기 가드를 갖는다」).
 */
export default async function FieldworkSurveyLayout({ params, children }: Props) {
  const { surveyId } = await params;
  const { user } = await assertFieldworkSurveyPageAccess(surveyId, 'operations.view');

  const subject = await loadAccessSubject(user);
  const [header, orgName] = await Promise.all([
    getFieldworkSurveyHeader(surveyId),
    subject.fieldworkOrgId ? getFieldworkOrgName(subject.fieldworkOrgId) : Promise.resolve(null),
  ]);
  // 관문을 지났는데 설문이 없다면 그 사이 삭제된 것이다 — 존재를 알리지 않는다.
  if (!header) notFound();

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <FieldworkHeaderBar
        user={user}
        organization={orgName}
        role={subject.fieldworkRole ?? 'worker'}
      />
      <FieldworkSurveyHeader
        surveyId={surveyId}
        title={header.title}
        teamName={header.teamName}
        ownerName={header.ownerName}
      />
      {children}
    </div>
  );
}
