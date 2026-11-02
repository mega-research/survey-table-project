import { and, count, eq, isNull } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactTargets, surveyAccessLinks } from '@/db/schema';
import {
  type ClientResponseColumnCandidate,
  type ClientResponseColumnSources,
  buildClientResponseColumnCandidates,
  clientResponseColumnSources,
} from '@/lib/operations/client-response-columns-format';
import { EXTERNAL_VIEWER_DATA_SCOPE, targetScopeCondition } from '@/server/data-scope';
import {
  type ClientResponseColumns,
  normalizeClientResponseColumns,
} from '@/shared/contracts/workspace';

import { getContactColumnScheme } from './contacts';
import {
  getProfileAnswerSources,
  getProfileColumnScheme,
  getProfileEntryParamNames,
} from './profile-column-scheme';

/**
 * 클라이언트 링크 응답 내역의 열 재료 (`.scratch/client-link-response-list` 티켓 04).
 *
 * 세 자리가 같은 재료를 본다 — 연구원의 「열 설정」 후보 목록(workspace), 저장 시 허용 판정
 * (workspace), 클라이언트가 보는 목록의 열 해석(operations). 도메인 서비스끼리는 서로 부를 수 없어
 * 여러 도메인 테이블을 읽기만 하는 이 층에 둔다.
 *
 * 파티션은 언제나 실데이터다. 클라이언트가 보는 것이 실데이터라, 연구원이 테스트 데이터를 보는
 * 중이어도 후보는 실데이터 명단 스킴에서 나와야 고른 열이 클라이언트 화면에 선다.
 */
export interface ClientResponseColumnMaterial {
  /** 고르는 화면의 후보이자 표 머리 라벨 사전. */
  candidates: ClientResponseColumnCandidate[];
  /** 허용 판정의 재료 — `isClientResponseColumnAllowed` 에 그대로 넘긴다. */
  sources: ClientResponseColumnSources;
  /** 실데이터 조사 대상이 있는가 — 시스템ID 열은 있을 때만 선다(내부 표·엑셀과 같은 규칙). */
  hasContacts: boolean;
}

export async function loadClientResponseColumnMaterial(
  surveyId: string,
): Promise<ClientResponseColumnMaterial> {
  const scope = EXTERNAL_VIEWER_DATA_SCOPE;
  const [contactScheme, profileScheme, entryParamNames, answerSources, contactCount] =
    await Promise.all([
      getContactColumnScheme(surveyId, scope),
      getProfileColumnScheme(surveyId),
      getProfileEntryParamNames(surveyId),
      getProfileAnswerSources(surveyId),
      // operations 의 getSurveyContactStats 와 같은 규칙(설문 설정 기준, 스코프 한정)이다 —
      // read-model 은 도메인 서비스를 부를 수 없어 같은 식을 여기서 센다.
      db
        .select({ total: count() })
        .from(contactTargets)
        .where(and(eq(contactTargets.surveyId, surveyId), targetScopeCondition(scope))),
    ]);
  const hasContacts = (contactCount[0]?.total ?? 0) > 0;
  return {
    candidates: buildClientResponseColumnCandidates({
      contactScheme,
      profileScheme,
      entryParamNames,
      answerSources,
      hasContacts,
    }),
    sources: clientResponseColumnSources({ contactScheme, entryParamNames, answerSources }),
    hasContacts,
  };
}

/**
 * 이 설문의 활성 클라이언트 링크가 저장한 열 설정(정규화만 — 허용 판정은 호출자가 한다).
 *
 * 링크가 없으면 기본 열이다. 클라이언트 콘솔은 링크 세션을 지난 뒤에만 이 값을 읽으므로 실제로는
 * 링크가 있다 — 없을 때 기본 열로 접는 것은 테스트·내부 미리보기에서 표가 사라지지 않게 하려는 것이다.
 */
export async function getActiveClientLinkResponseColumns(
  surveyId: string,
): Promise<ClientResponseColumns> {
  const [row] = await db
    .select({ columns: surveyAccessLinks.clientResponseColumns })
    .from(surveyAccessLinks)
    .where(
      and(
        eq(surveyAccessLinks.surveyId, surveyId),
        eq(surveyAccessLinks.kind, 'client'),
        isNull(surveyAccessLinks.closedAt),
      ),
    )
    .limit(1);
  return normalizeClientResponseColumns(row?.columns ?? null);
}
