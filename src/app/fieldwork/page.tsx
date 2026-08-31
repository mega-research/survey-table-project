import { notFound } from 'next/navigation';

import { FieldworkHomeView } from '@/features/fieldwork-console/fieldwork-home-view';
import { requireAccountTypePage } from '@/lib/auth/require-account-page';
import {
  getFieldworkOrgName,
  listInvitedFieldworkSurveys,
  listOrgFieldworkSurveys,
} from '@/server/read-models/fieldwork-surveys';
import { loadAccessSubject } from '@/server/survey-access';

/**
 * 실사 홈 (.pen FLOW 10-1, 역할 모델 v2 티켓 25).
 *
 * **소속·역할은 세션이 아니라 판정 코어에서 온다.** `loadAccessSubject` 가 활성 업체일 때만
 * 소속을 채우므로, 업체가 종료되면 이 화면도 함께 닫힌다 — 목록만 따로 조회하면 「홈에는
 * 보이는데 눌러도 안 열리는」 어긋남이 생긴다(판정과 목록의 정본이 둘이 된다).
 *
 * 소속이 없으면 `notFound` 다. 실사 계정에 소속이 없는 상태는 정의되지 않으므로(0093 CHECK)
 * 도달하려면 업체가 종료된 계정뿐이고, 그 사람에게는 보여줄 것도 할 일도 없다. 사유를
 * 갈라 말하지 않는 것은 게스트 콘솔의 관문과 같은 판단이다.
 *
 * 「업체 전체」 목록은 **팀장에게만** 조회한다 — 실사원에게 세그먼트 자체가 없으므로
 * 그 왕복은 순수한 낭비다.
 */
export default async function FieldworkHomePage() {
  const user = await requireAccountTypePage('fieldwork');
  const subject = await loadAccessSubject(user);
  if (!subject.fieldworkOrgId || !subject.fieldworkRole) notFound();

  const [invited, orgSurveys, orgName] = await Promise.all([
    listInvitedFieldworkSurveys(user.id),
    subject.fieldworkRole === 'leader'
      ? listOrgFieldworkSurveys(user.id, subject.fieldworkOrgId)
      : Promise.resolve(null),
    getFieldworkOrgName(subject.fieldworkOrgId),
  ]);

  return (
    <FieldworkHomeView
      user={user}
      organization={orgName}
      role={subject.fieldworkRole}
      invited={invited}
      orgSurveys={orgSurveys}
    />
  );
}
