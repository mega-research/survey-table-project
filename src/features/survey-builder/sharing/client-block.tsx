'use client';

import { useState } from 'react';

import { AccessLinkPanel } from './access-link-panel';
import { GuestsBlock } from './guests-block';
import { SegmentRow, type SegmentOption } from './segment-row';

interface ClientBlockProps {
  surveyId: string;
}

/**
 * 공유 설정 모달의 클라이언트 블록 — 고객사에게 현황을 여는 자리 (ADR-0029, .pen FLOW 4-2).
 *
 * **설문별 링크가 기본이다.** 고객사에게 계정을 발급하지 않고, 이 설문 전용 주소와 공유
 * 비밀번호를 만들어 전달한다 — 슈퍼어드민에게 계정을 부탁할 일이 없고, 담당자가 늘어도
 * 받은 쪽이 돌려 본다. 보이는 것이 현황·진척·마스킹된 명단·쿼터라 그렇게 퍼져도 위험이 낮다.
 *
 * ## 옛 게스트 계정 부여가 두 번째 세그먼트에 남아 있다
 *
 * 공존 창의 모양이다. 링크로 들어온 클라이언트가 볼 콘솔(`/client/<token>`)이 서기 전에 계정
 * 쪽 입구를 닫으면 클라이언트에게 열어 줄 길이 하나도 없는 구간이 생긴다. 콘솔이 선 뒤에
 * 이 세그먼트를 걷는다 — 실사 블록이 「내부 실사원 | 외주」로 가른 것과 같은 모양이다.
 *
 * 세그먼트를 오갈 때 아래 조각이 통째로 언마운트된다 — 계정 검색어·화면에만 머무는 평문
 * 비밀번호가 다른 세그먼트를 보고 돌아왔을 때 남아 있지 않게 하려는 것이다.
 */
export function ClientBlock({ surveyId }: ClientBlockProps) {
  const [mode, setMode] = useState<ClientMode>('link');

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[#374151]">클라이언트</span>

      <SegmentRow label="여는 방식" options={CLIENT_MODES} value={mode} onChange={setMode} />

      {mode === 'link' ? (
        <AccessLinkPanel surveyId={surveyId} kind="client" />
      ) : (
        <GuestsBlock surveyId={surveyId} />
      )}
    </div>
  );
}

/** 클라이언트에게 여는 방식 둘 — 링크가 기본이고 계정은 공존 창 동안만 남는다. */
type ClientMode = 'link' | 'account';

const CLIENT_MODES: ReadonlyArray<SegmentOption<ClientMode>> = [
  { value: 'link', label: '링크' },
  { value: 'account', label: '게스트 계정' },
];
