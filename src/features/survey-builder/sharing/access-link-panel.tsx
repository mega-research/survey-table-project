'use client';

import { useState } from 'react';

import { Check, Copy, Eye, EyeOff, Loader2, Pencil, Plus, RefreshCw } from 'lucide-react';

import { getErrorMessage } from '@/lib/get-error-message';
import { buildClientLinkUrl, buildFieldworkLinkUrl } from '@/lib/survey-url';
import { cn } from '@/lib/utils';
import {
  ACCESS_LINK_LABEL_MAX_LENGTH,
  type AccessLinkKind,
  type AccessLinkSurveyBlock,
  CLIENT_LINK_TAB_LABEL,
  type ClientLinkTab,
  type ClientLinkTabs,
  clientLinkTabValues,
  fieldworkLinkName,
} from '@/shared/contracts/workspace';
import type { AccessLinkListItem } from '@/shared/contracts/workspace-io';
import { internalOperationsPaths } from '@/utils/operations-paths';

import {
  useCloseAccessLink,
  useIssueAccessLink,
  useResetAccessLinkPassword,
  useRevealAccessLinkPassword,
  useSetAccessLinkLabel,
  useSetClientLinkTab,
  useSurveyAccessLinks,
} from '../queries/use-survey-access-link';
import { ClientResponseColumnsDialog } from './client-response-columns-dialog';

interface AccessLinkPanelProps {
  surveyId: string;
  /** 이 패널이 다루는 링크의 종류 — 조회·발급이 이 값으로 나간다. */
  kind: AccessLinkKind;
}

/**
 * 종류마다 갈리는 것 — **주소와 문구, 그리고 몇 개가 서는가.** 하는 일(발급·주소 복사·비밀번호
 * 보기·변경·종료)은 두 종류가 같아 카드를 한 벌로 둔다: 따로 짜면 한쪽만 고쳐진다.
 */
const PANEL_COPY: Record<
  AccessLinkKind,
  {
    buildUrl: (token: string) => string;
    /** 발급 칸 아래 — 이 링크가 무엇을 여는가. */
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
      '외주 업체마다 링크를 하나씩 발급합니다 — 주소·비밀번호가 링크마다 따로이고, 조사 대상·결과 기록·대리 응답이 열립니다. 이름표는 연구원만 보는 메모로, 외주 화면에는 보이지 않습니다.',
    lifecycle:
      '설문을 중단하거나 종료하면 닫힙니다. 링크가 유출되거나 업체를 바꿀 때는 비밀번호만 변경하세요 — 주소는 링크마다 고정입니다. 링크와 비밀번호는 서로 다른 채널로 전달하는 것이 안전합니다.',
    closeConfirm:
      '이 링크를 종료하면 이 링크로 들어오던 외주가 더 이상 들어오지 못합니다. 다른 외주 링크는 그대로입니다.',
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
 * 이 패널의 칸·버튼 치수 — 줄마다 같은 문자열을 적어 두면 한 줄만 고쳐져 칸 끝이 어긋난다.
 *
 * 높이는 전부 36px 이고 값 칸 옆 버튼은 폭까지 같다. 「복사 ↔ 복사됨」「보기 ↔ 가리기」로 글자가
 * 바뀌어도 왼쪽 칸의 끝이 움직이지 않고, 세 줄(주소·비밀번호·직접 입력)의 양 끝이 한 줄로 선다.
 * 색은 이 모달의 것(주 동작 #2E4FCE)을 따른다 — 모달 하단 「저장」과 같은 버튼으로 읽혀야 한다.
 */
const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2E4FCE]';

/** 고칠 수 있는 칸 — 흰 바탕 + 테두리. 읽기 전용 값 칸(`READONLY_BOX`)과 바탕으로 갈린다. */
const TEXT_INPUT =
  'h-9 min-w-0 rounded-[8px] border border-[#D1D5DB] bg-white px-2.5 text-[12px] text-[#1C1C1E] transition-[border-color,box-shadow] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:border-[#2E4FCE] focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/20 disabled:cursor-not-allowed disabled:bg-[#F3F4F6]';

/** 읽기 전용 값 칸(주소·비밀번호) — 채운 바탕, 테두리 없음. */
const READONLY_BOX = 'h-9 min-w-0 flex-1 rounded-[8px] bg-[#F3F4F6] px-2.5';

const SECONDARY_BUTTON = cn(
  'flex h-9 shrink-0 items-center justify-center gap-1 rounded-[8px] border border-[#D1D5DB] bg-white px-3 text-[12px] text-[#374151] transition-colors enabled:hover:bg-[#F5F5F7] disabled:cursor-not-allowed disabled:text-[#9CA3AF]',
  FOCUS_RING,
);

/** 값 칸 옆 동작(복사·보기·변경) — 폭 고정. */
const ROW_ACTION = cn(SECONDARY_BUTTON, 'w-[72px] px-0');

const PRIMARY_BUTTON = cn(
  'flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[8px] bg-[#2E4FCE] px-3.5 text-[12.5px] font-semibold text-white transition-colors enabled:hover:bg-[#2743AE] disabled:cursor-not-allowed disabled:bg-[#E5E7EB] disabled:text-[#9CA3AF]',
  FOCUS_RING,
);

const TEXT_LINK = cn(
  'rounded-[4px] text-[12px] text-[#2743AE] underline-offset-2 transition-colors hover:underline disabled:cursor-not-allowed disabled:text-[#9CA3AF] disabled:no-underline',
  FOCUS_RING,
);

/** 안내 문단 — 닫히는 조건처럼 읽어야 하는 글이라 본문 대비(4.5:1 이상)를 지킨다. */
const HELP_TEXT = 'text-[11px] leading-[1.5] text-[#6E6E73]';

/**
 * 설문 상태 때문에 링크가 지금 닫혀 있다는 안내 — 카드 위에 한 번만 선다.
 *
 * 카드 아래 `lifecycle` 문단은 「언제 닫히는가」(규칙)를 말하고 이쪽은 「지금 닫혀 있다」(상태)를
 * 말한다. 규칙만 있으면 담당자는 멀쩡해 보이는 카드를 보고 외주에게 「다시 해 보라」고 한다.
 * 사유별 문구에 다시 여는 방법을 함께 적는다 — 링크를 새로 발급할 일이 아니기 때문이다.
 */
const SURVEY_BLOCK_NOTICE: Record<AccessLinkKind, Record<AccessLinkSurveyBlock, string>> = {
  fieldwork: {
    paused:
      '설문이 중단되어 있어 지금은 외주가 이 링크로 들어올 수 없습니다. 설문을 재개하면 같은 주소·같은 비밀번호로 다시 열립니다.',
    closed:
      '설문이 종료되어 있어 지금은 외주가 이 링크로 들어올 수 없습니다. 종료를 취소하거나 다시 배포하면 같은 주소·같은 비밀번호로 다시 열립니다.',
  },
  client: {
    // 클라이언트 링크는 중단에 닫히지 않는다 — 서버가 이 조합을 주지 않지만 어휘 전부에 문구를 둔다.
    paused:
      '설문이 중단되어 있습니다. 클라이언트 링크는 중단 중에도 열려 있습니다.',
    closed:
      '설문이 종료되어 있어 지금은 클라이언트가 이 링크로 들어올 수 없습니다. 종료를 취소하거나 다시 배포하면 같은 주소·같은 비밀번호로 다시 열립니다.',
  },
};

function SurveyBlockNotice({
  kind,
  block,
}: {
  kind: AccessLinkKind;
  block: AccessLinkSurveyBlock | null;
}) {
  if (!block) return null;
  return (
    <p
      role="status"
      className="rounded-[8px] bg-[#FFFBEB] px-2.5 py-2 text-[12px] leading-[1.5] font-medium text-[#92400E]"
    >
      {SURVEY_BLOCK_NOTICE[kind][block]}
    </p>
  );
}

const ERROR_TEXT = 'text-[12px] text-[#DC2626]';

/**
 * 링크 패널 — 전용 링크와 공유 비밀번호 (ADR-0026·0029, .pen FLOW 10-2).
 *
 * 실사 블록의 「외주」 세그먼트와 클라이언트 블록이 **같은 패널**을 쓴다. 갈리는 것은 몇 개가
 * 서는가다 — **외주 링크는 업체 수만큼**(fieldwork-multi-company 티켓 02, ADR-0035) 카드가 서고 각
 * 카드에 연구원용 이름표가 붙으며, 링크가 있어도 「외주 링크 추가」가 남는다. 클라이언트 링크는
 * 하나라 발급하면 발급 칸이 사라지고, 탭 칩과 응답 내역 열 설정이 그 카드에만 있다.
 *
 * 화면에 **없는 것이 계약**이다.
 *  - 업체명·담당자 칸이 없다: 외주 업체도 담당자도 시스템에 등록하지 않는다. 이름표는 업체가
 *    아니라 **링크의 메모**다(자유 글자, 중복 허용, 외주 화면에는 실리지 않는다).
 *  - 만료일 칸이 없다: 설문 중단·종료가 링크를 닫는다(ADR-0030). 그래서 그 사실을 적어 둔다 —
 *    만료일이 없는 이유를 담당자가 짐작하지 않게 한다.
 *  - 주소 재발급 버튼이 없다: 주소만 새어도 비밀번호 화면까지만 보이므로 주소를 갈아끼워
 *    막아지는 것이 없고, 고정이라 공유 문서에 박아 둘 수 있다. 사람을 막는 일은 전부
 *    비밀번호 변경이 진다.
 *
 * 비밀번호는 **가려 두고 눌러서 본다.** 조회 응답에 평문이 실리지 않아(서버가 싣지 않는다)
 * 「보기」가 전용 표면을 한 번 더 부르며, 그 호출이 구조화 로그에 남는다(지목한 링크 id 는
 * `targetLinkId` 칸). 발급 직후의 평문만 그 카드에 처음부터 보인다 — 자동 생성을 골랐을 때 연구원이
 * 그 값을 알 방법이 그것뿐이다.
 *
 * **자동 생성이 기본이고 직접 입력도 된다.** 기본을 자동으로 둔 것은 이 값이 전화로 읽어 주는
 * 값이라 혼동 문자를 뺀 문자셋이 필요해서이고, 직접 입력을 남긴 것은 업체가 쓰던 규칙에 맞춰야
 * 할 때가 있기 때문이다. 빈 칸으로 보내면 서버가 만든다 — 화면이 생성 규칙을 복제하지 않는다.
 */
export function AccessLinkPanel({ surveyId, kind }: AccessLinkPanelProps) {
  const { data, isPending, isError } = useSurveyAccessLinks(surveyId, kind);
  /**
   * 방금 발급한 링크의 평문 — 링크 id 별로 잠깐 들고 있다가 새 카드가 처음 그릴 때 넘긴다. 쿼리
   * 캐시에는 넣지 않는다(목록 응답에 평문이 없다는 계약을 화면이 깨지 않는다).
   */
  const [issuedPasswords, setIssuedPasswords] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);

  if (isPending) {
    return (
      <div className="flex items-center gap-2 py-3 text-[12px] text-[#9CA3AF]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        불러오는 중…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p role="alert" className={cn(ERROR_TEXT, 'py-3')}>
        링크 정보를 불러오지 못했습니다.
      </p>
    );
  }

  const onIssued = (linkId: string, password: string) => {
    setIssuedPasswords((prev) => ({ ...prev, [linkId]: password }));
    setAdding(false);
  };

  const issueSection = (
    <IssueSection
      surveyId={surveyId}
      kind={kind}
      canManage={data.canManage}
      onIssued={onIssued}
      {...(kind === 'fieldwork' && data.links.length > 0
        ? { onCancel: () => setAdding(false) }
        : {})}
    />
  );

  // 클라이언트 링크는 설문당 하나다 — 있으면 그 카드, 없으면 발급 칸.
  if (kind === 'client') {
    const link = data.links[0];
    if (!link) return <div className="pt-1">{issueSection}</div>;
    return (
      <div className="flex flex-col gap-2.5">
        <SurveyBlockNotice kind={kind} block={data.surveyBlock} />
        <AccessLinkCard
          key={link.id}
          surveyId={surveyId}
          link={link}
          canManage={data.canManage}
          initialPassword={issuedPasswords[link.id] ?? null}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 pt-1">
      {/* 닫혔다고 말할 링크가 있을 때만 — 발급 전에는 「지금 못 들어온다」가 가리킬 것이 없다. */}
      {data.links.length > 0 && <SurveyBlockNotice kind={kind} block={data.surveyBlock} />}
      {data.links.map((link) => (
        <AccessLinkCard
          key={link.id}
          surveyId={surveyId}
          link={link}
          canManage={data.canManage}
          initialPassword={issuedPasswords[link.id] ?? null}
        />
      ))}
      {data.links.length === 0 || adding ? (
        issueSection
      ) : (
        <button
          type="button"
          disabled={!data.canManage}
          onClick={() => setAdding(true)}
          className={cn(
            'flex h-9 w-full items-center justify-center gap-1 rounded-[10px] border border-dashed border-[#C7CBD4] text-[12px] text-[#374151] transition-colors enabled:hover:border-[#2E4FCE] enabled:hover:bg-[#F7F8FF] enabled:hover:text-[#2743AE] disabled:cursor-not-allowed disabled:text-[#9CA3AF]',
            FOCUS_RING,
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          외주 링크 추가
        </button>
      )}
    </div>
  );
}

/**
 * 발급 칸 — 외주 링크면 이름표 칸이 함께 선다. 비밀번호·이름표 둘 다 비워도 된다(서버가 만들고,
 * 이름표 없는 링크는 순번으로 구별된다).
 */
function IssueSection({
  surveyId,
  kind,
  canManage,
  onIssued,
  onCancel,
}: {
  surveyId: string;
  kind: AccessLinkKind;
  canManage: boolean;
  onIssued: (linkId: string, password: string) => void;
  /** 이미 링크가 있는 외주 블록에서 「외주 링크 추가」로 연 칸만 닫을 수 있다. */
  onCancel?: () => void;
}) {
  const copy = PANEL_COPY[kind];
  const issue = useIssueAccessLink();
  const [draft, setDraft] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleIssue() {
    setError(null);
    const typedPassword = draft.trim();
    const typedLabel = label.trim();
    try {
      const result = await issue.mutateAsync({
        surveyId,
        kind,
        // 빈 칸은 보내지 않는다 — optional 입력이라 생략이 「서버가 만든다 / 이름표 없음」의 뜻이다.
        ...(typedPassword.length > 0 ? { password: typedPassword } : {}),
        ...(kind === 'fieldwork' && typedLabel.length > 0 ? { label: typedLabel } : {}),
      });
      setDraft('');
      setLabel('');
      onIssued(result.link.id, result.password);
    } catch (err) {
      setError(getErrorMessage(err, copy.failure));
    }
  }

  const disabled = issue.isPending || !canManage;
  return (
    // 이미 링크가 있는 목록 끝에서 연 칸은 카드 틀을 두른다 — 위 카드들과 같은 줄에 서는 「새 링크」로 읽힌다.
    <div
      className={cn(
        'flex flex-col gap-2',
        onCancel && 'rounded-[10px] border border-[#E5E5EA] bg-[#FAFAFC] p-3',
      )}
    >
      {kind === 'fieldwork' && (
        <input
          aria-label="이름표"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={disabled}
          maxLength={ACCESS_LINK_LABEL_MAX_LENGTH}
          placeholder="이름표 (예: 업체명) — 연구원만 봅니다"
          className={cn(TEXT_INPUT, 'w-full')}
        />
      )}
      {/* 칸과 버튼을 한 줄에 둔다 — 비밀번호를 정하고 바로 발급하는 한 동작이다. 좁으면 버튼이 아래로 내려간다. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <PasswordDraftInput
          ariaLabel="접속 비밀번호"
          value={draft}
          onChange={setDraft}
          disabled={disabled}
          className="min-w-[200px] flex-1"
        />
        <button type="button" disabled={disabled} onClick={handleIssue} className={PRIMARY_BUTTON}>
          {issue.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          링크 발급
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
            취소
          </button>
        )}
      </div>
      <p className={HELP_TEXT}>{copy.intro}</p>
      {error && (
        <p role="alert" className={ERROR_TEXT}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * 링크 카드 하나 — 주소·비밀번호·변경·종료(+ 클라이언트면 탭 칩). **상태가 카드마다 따로다**:
 * 한 링크의 평문 비밀번호·확인 행·오류가 다른 링크 카드에 번지지 않는다. 보기·변경·종료·이름표는
 * 전부 **이 카드의 링크 id** 로 나간다(티켓 01 — 종류는 하나를 가리키지 못한다).
 */
function AccessLinkCard({
  surveyId,
  link,
  canManage,
  initialPassword,
}: {
  surveyId: string;
  link: AccessLinkListItem;
  canManage: boolean;
  initialPassword: string | null;
}) {
  const copy = PANEL_COPY[link.kind];
  const [error, setError] = useState<string | null>(null);
  /** 화면에만 머무는 평문 — 쿼리 캐시에 넣지 않는다. */
  const [password, setPassword] = useState<string | null>(initialPassword);
  const [copied, setCopied] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  /** 직접 입력칸. 비어 있으면 서버가 만든다 — 생성 규칙을 화면이 복제하지 않는다. */
  const [draft, setDraft] = useState('');

  const reset = useResetAccessLinkPassword();
  const reveal = useRevealAccessLinkPassword();
  const close = useCloseAccessLink();
  const setTab = useSetClientLinkTab();
  const busy = reset.isPending || reveal.isPending || close.isPending || setTab.isPending;

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

  // baseUrl 을 넘기지 않는다 — 기본값이 브라우저 origin 이고, 이 컴포넌트는 클라이언트 전용이다.
  const url = copy.buildUrl(link.token);
  const tabs = link.clientTabs;
  const target = { surveyId, linkId: link.id };
  const isFieldwork = link.kind === 'fieldwork';
  const name = fieldworkLinkName(link);

  const body = (
    <>
      {/* 주소 · 비밀번호 · 직접 입력 — 세 줄의 양 끝이 한 줄로 선다(칸 높이 36px, 오른쪽 버튼 폭 고정).
          「변경」은 직접 입력 칸 옆에 둔다: 그 칸에 적은 값(비우면 자동 생성)으로 바꾸는 버튼이라,
          떨어져 있으면 칸이 무엇에 쓰이는지 보이지 않는다. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <code
            title={url}
            className={cn(
              READONLY_BOX,
              'block truncate text-[12px] leading-9 text-[#374151] select-all',
            )}
          >
            {url}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className={ROW_ACTION}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? '복사됨' : '복사'}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <div className={cn(READONLY_BOX, 'flex items-center gap-2.5')}>
            <span className="shrink-0 text-[12px] text-[#6E6E73]">접속 비밀번호</span>
            <code
              className={cn(
                'min-w-0 truncate text-[12px]',
                password ? 'text-[#1C1C1E] select-all' : 'tracking-[0.2em] text-[#9CA3AF]',
              )}
            >
              {password ?? '••••••••'}
            </code>
          </div>
          <button
            type="button"
            disabled={busy || !canManage}
            onClick={() =>
              password
                ? setPassword(null)
                : run(async () => (await reveal.mutateAsync(target)).password)
            }
            className={ROW_ACTION}
          >
            {password ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {password ? '가리기' : '보기'}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <PasswordDraftInput
            ariaLabel="새 접속 비밀번호"
            value={draft}
            onChange={setDraft}
            disabled={busy || !canManage}
            className="flex-1"
          />
          <button
            type="button"
            disabled={busy || !canManage}
            onClick={() =>
              run(async () => (await reset.mutateAsync({ ...target, ...passwordArg() })).password)
            }
            className={ROW_ACTION}
          >
            {reset.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            변경
          </button>
        </div>
      </div>

      {/* 클라이언트 링크에만 있는 축 — 보여 줄 화면. 외주 링크는 탭이 고정이라 값이 null 이다.
          권한이 없어도 칩은 **보인다**: 지금 무엇이 열려 있는지는 초대한 사람도 알아야 한다. */}
      {tabs && (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-[#374151]">보여 줄 화면</span>
            {/* 응답 내역 칩이 꺼져 있어도 열은 미리 고를 수 있다 — 켜는 순간 고른 열로 열린다. */}
            <button
              type="button"
              disabled={busy || !canManage}
              onClick={() => setColumnsOpen(true)}
              className={TEXT_LINK}
            >
              응답 내역 열 설정
            </button>
          </div>
          <ClientTabChips
            tabs={tabs}
            disabled={busy || !canManage}
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
          <p className={HELP_TEXT}>바꾼 내용은 클라이언트의 다음 화면부터 반영됩니다.</p>
          {columnsOpen && (
            <ClientResponseColumnsDialog
              surveyId={surveyId}
              onClose={() => setColumnsOpen(false)}
            />
          )}
        </div>
      )}

      {/* 닫히는 조건과 종료 — 이 링크의 수명을 다루는 한 묶음이다. */}
      <div className="flex flex-col gap-1.5">
        <p className={HELP_TEXT}>{copy.lifecycle}</p>

        {confirmingClose ? (
          <div className="flex flex-col gap-2 rounded-[8px] bg-[#FEF2F2] p-2.5">
            <div className="flex flex-col gap-1 text-[12px] leading-[1.5] text-[#374151]">
              <span>{copy.closeConfirm}</span>
              {/* 종료가 같은 트랜잭션에서 이 링크의 담당 범위를 푼다(티켓 09) — 그 대상들이 어느 업체에도
                  속하지 않게 됨을 알고 종료하게 한다. 인원은 링크 목록이 실어 온 지금 범위다. */}
              {link.share?.divided && link.share.count > 0 && (
                <span className="font-semibold text-[#B45309]">
                  이 링크의 담당 범위 {link.share.count.toLocaleString('ko-KR')}명이 풀립니다 — 그
                  대상은 어느 링크에도 속하지 않게 됩니다. 이 링크가 남긴 회차·수정 기록은 남습니다.
                </span>
              )}
            </div>
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setConfirmingClose(false)}
                className={cn(SECONDARY_BUTTON, 'h-8')}
              >
                취소
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setError(null);
                  try {
                    await close.mutateAsync(target);
                    setPassword(null);
                    setConfirmingClose(false);
                  } catch (err) {
                    setError(getErrorMessage(err, copy.failure));
                  }
                }}
                className={cn(
                  'flex h-8 items-center rounded-[8px] bg-[#DC2626] px-3 text-[12px] font-semibold text-white transition-colors enabled:hover:bg-[#B91C1C] disabled:cursor-not-allowed disabled:bg-[#E5E7EB] disabled:text-[#9CA3AF]',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DC2626]',
                )}
              >
                종료
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy || !canManage}
            onClick={() => setConfirmingClose(true)}
            className={cn(
              '-ml-1.5 flex h-7 items-center self-start rounded-[6px] px-1.5 text-[12px] text-[#DC2626] transition-colors enabled:hover:bg-[#FEF2F2] disabled:cursor-not-allowed disabled:text-[#9CA3AF]',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#DC2626]',
            )}
          >
            종료
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className={ERROR_TEXT}>
          {error}
        </p>
      )}
    </>
  );

  // 클라이언트 링크는 하나라 머리줄이 없다 — 블록 제목이 곧 그 링크다.
  if (!isFieldwork) return <div className="flex flex-col gap-2.5 pt-1">{body}</div>;

  return (
    <div
      role="group"
      aria-label={name}
      className="flex flex-col gap-2.5 rounded-[10px] border border-[#E5E5EA] bg-white p-3"
    >
      {/* 머리 — 이 링크가 누구 것이고 무엇을 맡는가. 아래 접속 수단과 간격으로 가른다. */}
      <div className="flex flex-col gap-1">
        <LinkLabelHeader surveyId={surveyId} link={link} canManage={canManage} name={name} />
        <ShareSummaryRow surveyId={surveyId} linkId={link.id} share={link.share} />
      </div>
      {body}
    </div>
  );
}

/**
 * 링크 카드의 담당 범위 요약 — 건네기 전에 나눴는지 한눈에 보이게(ADR-0035). 나누지 않은 링크는 설문
 * 전체를 보므로 그 사실을 그대로 적고, 나눈 링크는 지금 인원을 적는다(0명이어도 0명). 이름표처럼
 * 연구원 화면에만 있다.
 */
function ShareSummaryRow({
  surveyId,
  linkId,
  share,
}: {
  surveyId: string;
  linkId: string;
  share: AccessLinkListItem['share'];
}) {
  if (!share) return null;
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="shrink-0 text-[#6E6E73]">담당 범위</span>
      <span className="min-w-0 flex-1 truncate text-[#1C1C1E]">
        {share.divided ? `나눔 · ${share.count.toLocaleString('ko-KR')}명` : '설문 전체'}
      </span>
      <a
        href={internalOperationsPaths(surveyId).contactsShare(linkId)}
        className={cn(TEXT_LINK, 'shrink-0')}
      >
        담당 범위 나누기
      </a>
    </div>
  );
}

/**
 * 외주 링크 카드의 머리줄 — 이름(이름표 또는 「링크 N」)과 이름표 고치기.
 *
 * 이름표는 **글자로만** 그린다(HTML 아님). 비워 저장하면 이름표를 지우고 순번으로 돌아간다 —
 * 순번은 종료된 링크까지 센 값이라 하나를 종료해도 남은 링크의 이름이 바뀌지 않는다.
 */
function LinkLabelHeader({
  surveyId,
  link,
  canManage,
  name,
}: {
  surveyId: string;
  link: AccessLinkListItem;
  canManage: boolean;
  name: string;
}) {
  const saveLabel = useSetAccessLinkLabel();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const typed = draft.trim();
    try {
      await saveLabel.mutateAsync({
        surveyId,
        linkId: link.id,
        label: typed.length > 0 ? typed : null,
      });
      setEditing(false);
    } catch (err) {
      setError(getErrorMessage(err, '이름표를 저장하지 못했습니다.'));
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <input
            aria-label="이름표"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={ACCESS_LINK_LABEL_MAX_LENGTH}
            placeholder={`비우면 「${fieldworkLinkName({ label: null, ordinal: link.ordinal })}」`}
            disabled={saveLabel.isPending}
            className={cn(TEXT_INPUT, 'h-8 flex-1')}
          />
          <button
            type="button"
            disabled={saveLabel.isPending}
            onClick={handleSave}
            className={cn(PRIMARY_BUTTON, 'h-8 px-3 text-[12px]')}
          >
            저장
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className={cn(SECONDARY_BUTTON, 'h-8')}
          >
            취소
          </button>
        </div>
        {error && (
          <p role="alert" className={ERROR_TEXT}>
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    // 머리줄 높이를 편집 상태(32px)와 같게 둔다 — 「이름표 고치기」를 눌러도 아래 줄이 밀리지 않는다.
    <div className="flex h-8 items-center gap-2">
      <span className="min-w-0 truncate text-[13px] font-semibold text-[#1C1C1E]">{name}</span>
      {link.label === null && (
        <span className="shrink-0 rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10.5px] font-semibold text-[#4B5563]">
          이름표 없음
        </span>
      )}
      <button
        type="button"
        disabled={!canManage}
        onClick={() => {
          setDraft(link.label ?? '');
          setError(null);
          setEditing(true);
        }}
        className={cn(TEXT_LINK, 'ml-auto flex shrink-0 items-center gap-1')}
      >
        <Pencil className="h-3 w-3" />
        이름표 고치기
      </button>
    </div>
  );
}

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
      {clientLinkTabValues.map((tab) => {
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
              'flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              FOCUS_RING,
              active
                ? 'border-[#2E4FCE] bg-[#EEF2FF] text-[#2743AE] enabled:hover:bg-[#E0E7FF]'
                : 'border-[#E5E5EA] bg-white text-[#6E6E73] enabled:hover:border-[#C7CBD4] enabled:hover:text-[#1C1C1E]',
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
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  /** 눈에 보이는 라벨이 없는 칸이라 스크린리더가 읽을 이름을 받는다 — 발급 칸과 변경 칸이 다르다. */
  ariaLabel: string;
  className?: string;
}) {
  return (
    <input
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder="비밀번호 직접 입력 (비우면 자동 생성)"
      className={cn(TEXT_INPUT, className)}
    />
  );
}
