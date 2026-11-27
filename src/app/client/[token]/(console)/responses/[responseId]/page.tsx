import { notFound } from 'next/navigation';

import { parseResponseIdx } from '@/app/_operations/response-edit-idx';
import { ResponseEditScreen } from '@/app/_operations/response-edit-screen';
import {
  CLIENT_RESPONSES_SEGMENT,
  guestConsoleHref,
} from '@/features/guest-console/guest-vocabulary';
import { clientLinkPath } from '@/lib/survey-url';
import { EXTERNAL_VIEWER_DATA_SCOPE } from '@/server/data-scope';
import { FIELDWORK_SHARE_ALL } from '@/server/fieldwork-share-scope';
import { decodeClientResponseViewKey } from '@/server/operations/services/client-responses';
import { assertClientLinkPageAccess } from '@/server/page-client-link-access';

interface PageProps {
  params: Promise<{ token: string; responseId: string }>;
  searchParams: Promise<{ idx?: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '응답 조회' };

/**
 * 응답 조회 — 클라이언트 링크 입구 (`.scratch/client-link-response-extras`). 「응답 조회」 칩
 * (`responseView`, 응답 내역에 딸린 칩)이 열린 링크에서만 선다.
 *
 * 본문은 내부·외주 콘솔의 응답 수정 화면을 **잠가** 그린다(`readOnly` — 값 쓰기·검증·저장 없음, 운영
 * main 의 보기 전용 고객 계정 응답 조회와 같은 본문). 답은 원문 그대로다(2026-11-27 사용자 결정).
 * 명단 값은 설문이 실제로 읽는 열만 실리고(readOnly 규칙), 조사표 패널은 싣지 않는다.
 *
 * **주소에 응답 id 가 없다** — 목록이 실은 조회 키(`<링크 id>:<응답 id>` 의 인증 암호문)를 이 링크로만
 * 푼다. 응답 id 는 진행 중 실응답의 쓰기 권한이라(공개 답 저장이 응답 id 하나로 지난다) 밖에 내주지 않는다.
 * 다른 링크의 키·위조 키는 notFound 이고, 링크를 닫고 다시 발급하면 옛 키는 전부 죽는다.
 *
 * 응답은 관문이 돌려준 설문 id 로만 찾는다 — 남의 설문·테스트·삭제된 응답이면 read-model 의 WHERE 와 파티션
 * 대조에서 떨어져 notFound 다. 클라이언트 링크에는 담당 범위 축이 없다(설문 전체, ADR-0029·ADR-0035).
 * 본문은 외부 열람 모드(`externalViewer`)로 그린다 — 조사표·이월 응답을 싣지 않고, 명단 값은 설문이 실제로
 * 읽는 열만, 배포 스냅샷이 없으면 브라우저 RPC 로 폴백하지 않고 안내만 그린다(이 트리에는 RPC 표면이 없다).
 */
export default async function ClientLinkResponseViewPage({ params, searchParams }: PageProps) {
  const { token, responseId: viewKey } = await params;
  // 레이아웃은 소프트 내비게이션에서 다시 돌지 않는다 — 여기서 칩까지 다시 묻는다.
  const { surveyId, linkId } = await assertClientLinkPageAccess(token, 'responseView');
  const responseId = decodeClientResponseViewKey(linkId, decodeURIComponent(viewKey));
  if (responseId === null) notFound();
  const sp = await searchParams;
  const responsesHref = guestConsoleHref(clientLinkPath(token), CLIENT_RESPONSES_SEGMENT);

  return (
    <ResponseEditScreen
      surveyId={surveyId}
      responseId={responseId}
      basePath={clientLinkPath(token)}
      scope={EXTERNAL_VIEWER_DATA_SCOPE}
      share={FIELDWORK_SHARE_ALL}
      idx={parseResponseIdx(sp.idx)}
      readOnly
      externalViewer
      closeHref={responsesHref}
    />
  );
}
