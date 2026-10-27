'use client';

import { useState } from 'react';

import { Check, Copy, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';

import { getErrorMessage } from '@/lib/get-error-message';
import { buildClientLinkUrl, buildFieldworkLinkUrl } from '@/lib/survey-url';
import { cn } from '@/lib/utils';
import {
  type AccessLinkKind,
  CLIENT_LINK_TAB_LABEL,
  type ClientLinkTab,
  type ClientLinkTabs,
  clientLinkTabValues,
} from '@/shared/contracts/workspace';

import {
  useCloseAccessLink,
  useIssueAccessLink,
  useResetAccessLinkPassword,
  useRevealAccessLinkPassword,
  useSetClientLinkTab,
  useSurveyAccessLink,
} from '../queries/use-survey-access-link';

interface AccessLinkPanelProps {
  surveyId: string;
  /** 이 패널이 다루는 링크의 종류 — 조회·발급·변경·종료가 전부 이 값으로 나간다. */
  kind: AccessLinkKind;
}

/**
 * 종류마다 갈리는 것 — **주소와 문구뿐이다.** 하는 일(발급·주소 복사·비밀번호 보기·변경·
 * 종료)은 두 종류가 같아 패널을 한 벌로 둔다: 따로 짜면 한쪽만 고쳐진다.
 */
const PANEL_COPY: Record<
  AccessLinkKind,
  {
    buildUrl: (token: string) => string;
    /** 발급 전 — 이 링크가 무엇을 여는가. */
    intro: string;
    /** 발급 후 — 언제 닫히고, 사람을 막으려면 무엇을 하는가. */
    lifecycle: string;
    closeConfirm: string;
    failure: string;
  }
> = {
  fieldwork: {
    buildUrl: buildFieldworkLinkUrl,
    intro:
      '링크 하나로 조사 대상·결과 기록·대리 응답이 열립니다. 업체도 담당자도 등록하지 않습니다.',
    lifecycle:
      '설문을 중단하거나 종료하면 닫힙니다. 링크가 유출되거나 업체를 바꿀 때는 비밀번호만 변경하세요 — 주소는 설문당 하나로 고정입니다. 링크와 비밀번호는 서로 다른 채널로 전달하는 것이 안전합니다.',
    closeConfirm: '링크를 종료하면 외주가 더 이상 들어오지 못합니다.',
    failure: '외주 실사 링크를 처리하지 못했습니다.',
  },
  client: {
    buildUrl: buildClientLinkUrl,
    intro:
      '링크 하나로 이 설문의 현황을 열람합니다. 고객사 계정을 만들지 않습니다. 발급 뒤에 보여 줄 화면을 고릅니다.',
    // 외주 링크와 닫히는 조건이 다르다(ADR-0029·0030) — 클라이언트는 응답이 멈춘 뒤에 최종
    // 숫자를 보므로 중단에 닫히지 않는다. 그 차이를 적어 두지 않으면 담당자가 「중단했으니
    // 고객사도 못 본다」고 짐작한다.
    lifecycle:
      '설문을 중단해도 열려 있고, 종료하면 닫힙니다. 담당자가 바뀌거나 링크가 유출되면 비밀번호만 변경하세요 — 주소는 고정입니다. 링크와 비밀번호는 서로 다른 채널로 전달하는 것이 안전합니다.',
    closeConfirm: '링크를 종료하면 클라이언트가 더 이상 들어오지 못합니다.',
    failure: '클라이언트 링크를 처리하지 못했습니다.',
  },
};

/**
 * 링크 패널 — 전용 링크와 공유 비밀번호 (ADR-0026·0029, .pen FLOW 10-2).
 *
 * 실사 블록의 「외주」 세그먼트와 클라이언트 블록이 **같은 패널**을 쓴다. 클라이언트 링크에만
 * 있는 것은 탭 칩 하나다 — 보여 줄 화면을 고른다.
 *
 * 화면에 **없는 것이 계약**이다.
 *  - 업체명·담당자 칸이 없다: 외주 업체도 담당자도 시스템에 등록하지 않는다.
 *  - 만료일 칸이 없다: 설문 중단·종료가 링크를 닫는다(ADR-0030). 그래서 그 사실을 적어 둔다 —
 *    만료일이 없는 이유를 담당자가 짐작하지 않게 한다.
 *  - 주소 재발급 버튼이 없다: 주소만 새어도 비밀번호 화면까지만 보이므로 주소를 갈아끼워
 *    막아지는 것이 없고, 고정이라 공유 문서에 박아 둘 수 있다. 사람을 막는 일은 전부
 *    비밀번호 변경이 진다.
 *
 * 비밀번호는 **가려 두고 눌러서 본다.** 조회 응답에 평문이 실리지 않아(서버가 싣지 않는다)
 * 「보기」가 전용 표면을 한 번 더 부르며, 그 호출이 구조화 로그에 남는다.
 *
 * **자동 생성이 기본이고 직접 입력도 된다.** 기본을 자동으로 둔 것은 이 값이 전화로 읽어 주는
 * 값이라 혼동 문자를 뺀 문자셋이 필요해서이고, 직접 입력을 남긴 것은 업체가 쓰던 규칙에 맞춰야
 * 할 때가 있기 때문이다. 빈 칸으로 보내면 서버가 만든다 — 화면이 생성 규칙을 복제하지 않는다.
 */
export function AccessLinkPanel({ surveyId, kind }: AccessLinkPanelProps) {
  const copy = PANEL_COPY[kind];
  const [error, setError] = useState<string | null>(null);
  /** 화면에만 머무는 평문 — 쿼리 캐시에 넣지 않는다. */
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  /** 직접 입력칸. 비어 있으면 서버가 만든다 — 생성 규칙을 화면이 복제하지 않는다. */
  const [draft, setDraft] = useState('');

  const { data, isPending, isError } = useSurveyAccessLink(surveyId, kind);
  const issue = useIssueAccessLink();
  const reset = useResetAccessLinkPassword();
  const reveal = useRevealAccessLinkPassword();
  const close = useCloseAccessLink();
  const setTab = useSetClientLinkTab();
  const busy =
    issue.isPending ||
    reset.isPending ||
    reveal.isPending ||
    close.isPending ||
    setTab.isPending;

  async function run(action: () => Promise<string | null>) {
    setError(null);
    try {
      setPassword(await action());
      setDraft('');
    } catch (err) {
      setError(getErrorMessage(err, copy.failure));
    }
  }

  /** 빈 칸은 보내지 않는다 — optional 입력이라 생략이 「서버가 만든다」의 뜻이다. */
  function passwordArg(): { password?: string } {
    const typed = draft.trim();
    return typed.length > 0 ? { password: typed } : {};
  }

  if (isPending) {
    return (
      <div className="flex items-center gap-2 py-3 text-[12px] text-[#9CA3AF]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        불러오는 중…
      </div>
    );
  }

  if (isError || !data) {
    return <p className="py-3 text-[12px] text-[#DC2626]">링크 정보를 불러오지 못했습니다.</p>;
  }

  if (!data.link) {
    return (
      <div className="flex flex-col gap-2 py-1">
        <PasswordDraftInput value={draft} onChange={setDraft} disabled={busy || !data.canManage} />
        <button
          type="button"
          disabled={busy || !data.canManage}
          onClick={() =>
            run(
              async () => (await issue.mutateAsync({ surveyId, kind, ...passwordArg() })).password,
            )
          }
          className="flex h-9 items-center justify-center gap-1.5 rounded-[8px] bg-[#3b82f6] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
        >
          {issue.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          링크 발급
        </button>
        <p className="text-[11px] leading-[1.45] text-[#9CA3AF]">{copy.intro}</p>
        {error && <p className="text-[12px] text-[#DC2626]">{error}</p>}
      </div>
    );
  }

  // baseUrl 을 넘기지 않는다 — 기본값이 브라우저 origin 이고, 이 컴포넌트는 클라이언트 전용이다.
  const url = copy.buildUrl(data.link.token);
  const tabs = data.link.clientTabs;

  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded-[8px] bg-[#F3F4F6] px-2.5 py-2 text-[12px] text-[#374151]">
          {url}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex h-9 items-center gap-1 rounded-[8px] border border-[#D1D5DB] px-2.5 text-[12px] text-[#374151] transition-colors hover:bg-[#F9FAFB]"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? '복사됨' : '복사'}
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="w-[76px] shrink-0 text-[12px] text-[#6E6E73]">접속 비밀번호</span>
        <code
          className={cn(
            'min-w-0 flex-1 truncate rounded-[8px] bg-[#F3F4F6] px-2.5 py-2 text-[12px]',
            password ? 'text-[#374151]' : 'tracking-[0.2em] text-[#9CA3AF]',
          )}
        >
          {password ?? '••••••••'}
        </code>
        <button
          type="button"
          disabled={busy || !data.canManage}
          onClick={() =>
            password
              ? setPassword(null)
              : run(async () => (await reveal.mutateAsync({ surveyId, kind })).password)
          }
          className="flex h-9 items-center gap-1 rounded-[8px] border border-[#D1D5DB] px-2.5 text-[12px] text-[#374151] transition-colors hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:text-[#9CA3AF]"
        >
          {password ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {password ? '가리기' : '보기'}
        </button>
        <button
          type="button"
          disabled={busy || !data.canManage}
          onClick={() =>
            run(
              async () => (await reset.mutateAsync({ surveyId, kind, ...passwordArg() })).password,
            )
          }
          className="flex h-9 items-center gap-1 rounded-[8px] border border-[#D1D5DB] px-2.5 text-[12px] text-[#374151] transition-colors hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:text-[#9CA3AF]"
        >
          {reset.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          변경
        </button>
      </div>

      <PasswordDraftInput value={draft} onChange={setDraft} disabled={busy || !data.canManage} />

      {/* 클라이언트 링크에만 있는 축 — 보여 줄 화면. 외주 링크는 탭이 고정이라 값이 null 이다.
          권한이 없어도 칩은 **보인다**: 지금 무엇이 열려 있는지는 초대한 사람도 알아야 한다. */}
      {tabs && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-[#6E6E73]">보여 줄 화면</span>
          <ClientTabChips
            tabs={tabs}
            disabled={busy || !data.canManage}
            onToggle={async (tab) => {
              setError(null);
              try {
                // 누른 칩과 그 값만 보낸다. 네 값을 통째로 보내면 이 화면이 낡았을 때 다른
                // 사람이 방금 끈 칩을 되살린다. 응답이 저장 뒤의 전체 모습이라 캐시가 그것으로
                // 갈리고, 남이 바꾼 칩도 그때 함께 보인다.
                await setTab.mutateAsync({ surveyId, tab, enabled: !tabs[tab] });
              } catch (err) {
                setError(getErrorMessage(err, copy.failure));
              }
            }}
          />
          <p className="text-[11px] leading-[1.45] text-[#9CA3AF]">
            바꾼 내용은 클라이언트의 다음 화면부터 반영됩니다.
          </p>
        </div>
      )}

      <p className="text-[11px] leading-[1.45] text-[#9CA3AF]">{copy.lifecycle}</p>

      {confirmingClose ? (
        <div className="flex items-center gap-1.5">
          <span className="flex-1 text-[12px] text-[#374151]">{copy.closeConfirm}</span>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setError(null);
              try {
                await close.mutateAsync({ surveyId, kind });
                setPassword(null);
                setConfirmingClose(false);
              } catch (err) {
                setError(getErrorMessage(err, copy.failure));
              }
            }}
            className="h-8 rounded-[8px] bg-[#DC2626] px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-[#B91C1C] disabled:bg-[#9CA3AF]"
          >
            종료
          </button>
          <button
            type="button"
            onClick={() => setConfirmingClose(false)}
            className="h-8 rounded-[8px] border border-[#D1D5DB] px-2.5 text-[12px] text-[#374151]"
          >
            취소
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy || !data.canManage}
          onClick={() => setConfirmingClose(true)}
          className="self-start text-[12px] text-[#DC2626] transition-colors hover:underline disabled:cursor-not-allowed disabled:text-[#9CA3AF]"
        >
          종료
        </button>
      )}

      {error && <p className="text-[12px] text-[#DC2626]">{error}</p>}
    </div>
  );
}

/**
 * 아직 화면에 잇지 않은 칩 — 응답 내역(티켓 03, `.scratch/client-link-response-list`). 어휘는
 * 먼저 섰지만 켜도 클라이언트 화면이 그대로라 칩을 그리지 않는다. 그 티켓이 화면을 이으면서 뺀다.
 */
const PENDING_CHIPS: ReadonlySet<ClientLinkTab> = new Set(['responses']);

/**
 * 다른 칩에 딸린 칩 — 부모가 꺼져 있으면 잠근다. 상세 통계는 응답 현황 화면 안의 카드라 응답
 * 현황이 닫혀 있으면 켜도 보이는 곳이 없다. **값은 지우지 않는다** — 부모를 다시 켜면 연구원이
 * 두었던 대로 돌아온다(잠근 칩도 지금 값을 체크로 보인다).
 */
const CHIP_PARENT: Partial<Record<ClientLinkTab, ClientLinkTab>> = { overviewDetail: 'overview' };

/**
 * 클라이언트 링크의 화면 칩 — 게스트 넷에 설문 보기·상세 통계·응답 내역을 더한 어휘다.
 *
 * 순서는 `clientLinkTabValues` 가 정한다. 화면이 자기 배열을 들면 칩이 늘었을 때 계약에는
 * 있는데 안 그려지는 값이 생긴다.
 */
function ClientTabChips({
  tabs,
  disabled,
  onToggle,
}: {
  tabs: ClientLinkTabs;
  disabled: boolean;
  onToggle: (tab: ClientLinkTab) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {clientLinkTabValues.filter((tab) => !PENDING_CHIPS.has(tab)).map((tab) => {
        const active = tabs[tab];
        const parent = CHIP_PARENT[tab];
        const orphaned = parent !== undefined && !tabs[parent];
        return (
          <button
            key={tab}
            type="button"
            role="checkbox"
            aria-checked={active}
            disabled={disabled || orphaned}
            title={
              orphaned && parent ? `${CLIENT_LINK_TAB_LABEL[parent]} 칩을 켜야 보입니다` : undefined
            }
            onClick={() => onToggle(tab)}
            className={cn(
              'flex h-[26px] items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-50',
              active
                ? 'border-[#2E4FCE] bg-[#EEF2FF] text-[#2743AE]'
                : 'border-[#E5E5EA] bg-white text-[#6E6E73] hover:text-[#1C1C1E]',
            )}
          >
            {active && <Check className="h-3 w-3" />}
            {CLIENT_LINK_TAB_LABEL[tab]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 직접 입력칸 — 비워 두면 「변경」·「링크 발급」이 서버가 만든 값을 쓴다.
 *
 * 최소 길이를 화면에서 검사하지 않는다. 경계 스키마가 같은 규칙을 갖고 있고(`PasswordField`),
 * 규칙을 두 벌 적으면 한쪽만 고쳐져 「화면은 통과했는데 서버가 거부하는」 칸이 된다.
 */
function PasswordDraftInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder="비밀번호 직접 입력 (비우면 자동 생성)"
      className="h-9 rounded-[8px] border border-[#D1D5DB] bg-white px-2.5 text-[12px] text-[#1C1C1E] placeholder:text-[#9CA3AF] focus:outline-none disabled:bg-[#F3F4F6]"
    />
  );
}
