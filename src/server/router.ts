import { analytics } from '@/server/analytics/procedures/analytics';
import { auth } from '@/server/auth/procedures/auth';
import { users } from '@/server/auth/procedures/users';
import { attempts } from '@/server/contacts/procedures/attempts';
import { attrs } from '@/server/contacts/procedures/attrs';
import { attrValues } from '@/server/contacts/procedures/attr-values';
import { columns } from '@/server/contacts/procedures/columns';
import { resultCodes } from '@/server/contacts/procedures/result-codes';
import { targets } from '@/server/contacts/procedures/targets';
import { uploads } from '@/server/contacts/procedures/uploads';
import { transfer } from '@/server/library/procedures/library-transfer';
import { questionCategories } from '@/server/library/procedures/question-categories';
import { savedCells } from '@/server/library/procedures/saved-cells';
import { savedLookups } from '@/server/library/procedures/saved-lookups';
import { savedQuestions } from '@/server/library/procedures/saved-questions';
import { groups } from '@/server/survey-builder/procedures/groups';
import { lookups } from '@/server/survey-builder/procedures/lookups';
import { publicRead } from '@/server/survey-builder/procedures/public-read';
import { publish } from '@/server/survey-builder/procedures/publish';
import { questions } from '@/server/survey-builder/procedures/questions';
import { read } from '@/server/survey-builder/procedures/read';
import { save } from '@/server/survey-builder/procedures/save';
import { surveys } from '@/server/survey-builder/procedures/surveys';
import { testSample } from '@/server/survey-builder/procedures/test-sample';
import { billing } from '@/server/mail/procedures/billing';
import { campaigns } from '@/server/mail/procedures/campaigns';
import { preview } from '@/server/mail/procedures/preview';
import { templates } from '@/server/mail/procedures/templates';
import { unsubscribe } from '@/server/mail/procedures/unsubscribe';
import { fileCleanup } from '@/server/media/procedures/file-cleanup';
import { media } from '@/server/media/procedures/media';
import { control } from '@/server/operations/procedures/control';
import { profileColumns } from '@/server/operations/procedures/profile-columns';
import { progress } from '@/server/operations/procedures/progress';
import { quota } from '@/server/quota/procedures/quota';
import { guests } from '@/server/workspace/procedures/guests';
import { members } from '@/server/workspace/procedures/members';
import { ownership } from '@/server/workspace/procedures/ownership';
import { participants } from '@/server/workspace/procedures/participants';
import { reassignment } from '@/server/workspace/procedures/reassignment';
import { sharing } from '@/server/workspace/procedures/sharing';
import { surveyGroups } from '@/server/workspace/procedures/survey-groups';
import { teams } from '@/server/workspace/procedures/teams';
import { duplicate } from '@/server/survey-response/procedures/duplicate';
import { edit } from '@/server/survey-response/procedures/edit';
import { lifecycle } from '@/server/survey-response/procedures/lifecycle';
import { manage } from '@/server/survey-response/procedures/manage';
import { response } from '@/server/survey-response/procedures/response';

import { health } from '@/server/health';

export const router = {
  health,
  library: {
    savedQuestions,
    savedLookups,
    savedCells,
    questionCategories,
    transfer,
  },
  surveyBuilder: {
    surveys,
    save,
    publish,
    questions,
    groups,
    read,
    publicRead,
    lookups,
    testSample,
  },
  auth: {
    ...auth,
    users,
  },
  media: {
    ...media,
    fileCleanup,
  },
  analytics,
  contacts: {
    targets,
    columns,
    uploads,
    attempts,
    resultCodes,
    attrs,
    attrValues,
  },
  mail: {
    templates,
    preview,
    campaigns,
    billing,
    unsubscribe,
  },
  surveyResponse: {
    response,
    lifecycle,
    duplicate,
    edit,
    manage,
  },
  operations: {
    progress,
    profileColumns,
    control,
  },
  quota,
  workspace: {
    teams,
    members,
    // 설문 그룹. surveyBuilder.groups(문항 그룹)와 이름이 겹치지 않게 키를 길게 쓴다.
    surveyGroups,
    // 재배치 센터 — 팀을 잃은 사람·설문의 인박스 (슈퍼어드민 전용).
    reassignment,
    // 공유 설정 — 공개 범위 (.pen FLOW 4-2). 실사 블록은 티켓 24.
    sharing,
    // 설문 참여자 — 팀 경계를 넘는 유일한 접근 경로 (.pen FLOW 4-2, 티켓 18).
    participants,
    // 클라이언트(게스트) 부여 + 현황 탭 화이트리스트 (.pen FLOW 4-2, 티켓 21).
    guests,
    // 소유권 이전 · 승계 제안 (.pen FLOW 4-4·9-3, 티켓 19).
    ownership,
  },
};

export type AppRouter = typeof router;
