'use client';

import { AccessLinkPanel } from './access-link-panel';

interface ClientBlockProps {
  surveyId: string;
}

/**
 * 공유 설정 모달의 클라이언트 블록 — 고객사에게 현황을 여는 자리 (ADR-0029, .pen FLOW 4-2).
 *
 * **여는 길이 설문별 링크 하나다.** 고객사에게 계정을 발급하지 않고, 이 설문 전용 주소와 공유
 * 비밀번호를 만들어 전달한다 — 슈퍼어드민에게 계정을 부탁할 일이 없고, 담당자가 늘어도
 * 받은 쪽이 돌려 본다. 보이는 것이 현황·진척·마스킹된 명단·쿼터라 그렇게 퍼져도 위험이 낮다.
 *
 * ## 게스트 계정 부여 UI 는 걷혔다 (2026-10-12)
 *
 * 링크 콘솔(`/client/<token>`)이 서기 전까지는 「링크 | 게스트 계정」 세그먼트로 두 길이
 * 공존했다. 콘솔이 선 뒤 계정 쪽 입구를 닫았다 — 계정 생성 창에서도 게스트 유형이 함께
 * 사라졌다. **닫은 것은 입구다**: 부여 RPC(`workspace.guests`)와 그 화면 조각(`guests-block`),
 * 게스트 콘솔(`/guest`)은 남아 있고, 이미 부여된 게스트 계정은 종전대로 자기 설문을 본다.
 * 철거는 링크 모델로 실제 조사 한 건을 프로덕션에서 끝낸 뒤의 일이다(실사 블록의 옛 실사
 * 계정 모델과 같은 순서).
 *
 * 고를 것이 하나라 세그먼트 줄도 없다. 블록이 얇은 껍데기로 남는 것은 모달이 「클라이언트」
 * 라는 자리를 알고 링크 패널은 종류만 알기 때문이다.
 */
export function ClientBlock({ surveyId }: ClientBlockProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[#374151]">클라이언트</span>
      <AccessLinkPanel surveyId={surveyId} kind="client" />
    </div>
  );
}
