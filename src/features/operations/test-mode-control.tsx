'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Copy, Eye, FlaskConical, Power, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TestContactGeneratorDialog } from '@/features/operations/contacts/test-contact-generator-dialog';
import { getErrorMessage } from '@/lib/get-error-message';
import {
  TEST_VIEW_COOKIE_MAX_AGE_SECONDS,
  TEST_VIEW_COOKIE_VALUE,
  testViewCookieName,
} from '@/lib/operations/test-view-cookie';
import { client } from '@/shared/lib/rpc';

interface TestModeState {
  testModeEnabled: boolean;
  testViewInBrowser: boolean;
  testToken: string | null;
  accessIdentifier: string;
  testResponseCount: number;
  testTargetCount: number;
  firstTestInviteCode: string | null;
}

function toTestModeState(row: TestModeState): TestModeState {
  return {
    testModeEnabled: row.testModeEnabled,
    testViewInBrowser: row.testViewInBrowser,
    testToken: row.testToken,
    accessIdentifier: row.accessIdentifier,
    testResponseCount: row.testResponseCount,
    testTargetCount: row.testTargetCount,
    firstTestInviteCode: row.firstTestInviteCode,
  };
}

/** 조회 실패/설문 부재 시 버튼 OFF 폴백 상태 */
function offFallbackState(surveyId: string): TestModeState {
  return {
    testModeEnabled: false,
    testViewInBrowser: false,
    testToken: null,
    accessIdentifier: surveyId,
    testResponseCount: 0,
    testTargetCount: 0,
    firstTestInviteCode: null,
  };
}

/**
 * 이 브라우저의 「테스트 모드로 보기」 쿠키를 켜고 끈다. 콘솔 파티션은 서버가 이 쿠키와 설문의
 * 테스트 모드를 함께 보고 정하므로(server/data-scope) 바꾼 뒤에는 router.refresh 로 다시 읽는다.
 */
function writeTestViewCookie(surveyId: string, on: boolean) {
  const name = testViewCookieName(surveyId);
  document.cookie = on
    ? `${name}=${TEST_VIEW_COOKIE_VALUE}; path=/; max-age=${TEST_VIEW_COOKIE_MAX_AGE_SECONDS}; samesite=lax`
    : `${name}=; path=/; max-age=0; samesite=lax`;
}

function hasSameTestModeState(current: TestModeState | null, next: TestModeState): boolean {
  return (
    current !== null &&
    current.testModeEnabled === next.testModeEnabled &&
    current.testViewInBrowser === next.testViewInBrowser &&
    current.testToken === next.testToken &&
    current.accessIdentifier === next.accessIdentifier &&
    current.testResponseCount === next.testResponseCount &&
    current.testTargetCount === next.testTargetCount &&
    current.firstTestInviteCode === next.firstTestInviteCode
  );
}

interface Props {
  surveyId: string;
  /**
   * 초기 상태. 운영 헤더처럼 RSC 가 이미 알고 있으면 전달하고,
   * 편집 페이지처럼 모르면 생략 — 마운트 시 control.get 으로 조회한다.
   */
  initial?: TestModeState | undefined;
}

/**
 * 설문 테스트 모드 토글 (운영 콘솔·설문 편집 헤더 공용).
 *
 * 두 겹이다. 「테스트 모드」(`testModeEnabled` — 테스트 링크가 산다)는 설문 단위라 모두에게 같고,
 * 「테스트 데이터 보기」는 브라우저마다 쿠키로 정한다 — 한 사람이 켜도 다른 사람의 콘솔은 실데이터 그대로다.
 * 버튼 자체는 아무 동작이 없고 호버·클릭으로 메뉴 넷(테스트 모드 · 링크 복사 · 테스트 데이터 보기 ·
 * 대상자 생성)을 연다. 테스트 모드를 켜도 보기는 따로 켜고, 끌 때는 보관/삭제 확인 창을 거친다.
 *
 * 켜면 `/survey/{accessIdentifier}?test={token}` 링크가 활성화되어 중단/중복 게이트를 우회하고
 * 응답이 `survey_responses.isTest=true` 로 적재된다(집계 제외). 켜는 즉시 링크를
 * 클립보드에 복사하고, ON 상태에서는 amber 버튼 호버/클릭 드롭다운으로 링크 복사·끄기 제공.
 * 테스트 링크는 저장본(테스트 버전) 기준 — 저장만 하면 다음에 열 때 반영된다(CONTEXT.md 「테스트 버전」).
 * 저장하지 않은 편집은 반영되지 않는다.
 */
export function TestModeControl({ surveyId, initial }: Props) {
  const router = useRouter();
  const [state, setState] = useState<TestModeState | null>(initial ?? null);
  const [testOffConfirm, setTestOffConfirm] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const disableInFlight = useRef(false);
  const stateRef = useRef<TestModeState | null>(initial ?? null);
  const controlRequestVersion = useRef(0);

  // RSC refresh로 initial이 바뀌면 client local state도 같은 snapshot으로 맞춘다.
  // setState 는 effect 가 아니라 렌더 중 조정 패턴으로 처리한다 — ref 갱신(요청 버전
  // 무효화 포함)은 렌더 중 불가하므로 아래 effect 에 남긴다.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    if (initial) {
      const next = toTestModeState(initial);
      setState((current) => (hasSameTestModeState(current, next) ? current : next));
    }
  }

  useEffect(() => {
    if (initial) {
      controlRequestVersion.current += 1;
      stateRef.current = toTestModeState(initial);
      return;
    }
    let cancelled = false;
    const requestVersion = ++controlRequestVersion.current;
    client.operations.control
      .get({ surveyId })
      .then((row) => {
        if (cancelled || requestVersion !== controlRequestVersion.current) return;
        // null = 미저장/삭제 설문 — OFF 폴백 (서버가 500 대신 null 을 주는 규약)
        const next = row ? toTestModeState(row) : offFallbackState(surveyId);
        stateRef.current = next;
        setState(next);
      })
      .catch(() => {
        // 조회 실패 시 버튼은 OFF 모양으로 폴백 — 클릭 시 토글 시도에서 에러 안내
        if (cancelled || requestVersion !== controlRequestVersion.current) return;
        const fallback = offFallbackState(surveyId);
        stateRef.current = fallback;
        setState(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, [initial, surveyId]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 다른 관리자/탭의 전역 변경을 focus와 10초 polling으로 반영한다. 동일 snapshot이면
  // local/RSC 모두 건드리지 않아 불필요한 router refresh를 만들지 않는다.
  useEffect(() => {
    let cancelled = false;
    const syncControl = async () => {
      const requestVersion = ++controlRequestVersion.current;
      try {
        const row = await client.operations.control.get({ surveyId });
        if (cancelled) return;
        if (requestVersion !== controlRequestVersion.current) return;
        if (!row) return; // 미저장/삭제 설문 — 동기화할 서버 상태가 없다
        const next = toTestModeState(row);
        if (hasSameTestModeState(stateRef.current, next)) return;
        stateRef.current = next;
        setState(next);
        router.refresh();
      } catch {
        // 주기 동기화 실패는 다음 focus/poll에서 재시도한다.
      }
    };
    const interval = window.setInterval(() => void syncControl(), 10_000);
    window.addEventListener('focus', syncControl);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', syncControl);
    };
  }, [router, surveyId]);

  // 테스트 모드 드롭다운 — 클릭 외에 호버로도 열린다. 대각선 이동 중 닫힘을 막기 위해
  // mouseleave 후 200ms 지연 뒤 닫고, 트리거/콘텐츠 어느 쪽이든 재진입하면 취소한다.
  const [testMenuOpen, setTestMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuCloseTimer = useRef<number | null>(null);

  const openTestMenu = () => {
    if (menuCloseTimer.current !== null) {
      window.clearTimeout(menuCloseTimer.current);
      menuCloseTimer.current = null;
    }
    setTestMenuOpen(true);
  };

  const scheduleTestMenuClose = () => {
    if (menuCloseTimer.current !== null) {
      window.clearTimeout(menuCloseTimer.current);
    }
    menuCloseTimer.current = window.setTimeout(() => setTestMenuOpen(false), 200);
  };

  useEffect(
    () => () => {
      if (menuCloseTimer.current !== null) {
        window.clearTimeout(menuCloseTimer.current);
      }
    },
    [],
  );

  // 설문의 테스트 모드(모든 사람) · 이 브라우저의 콘솔이 지금 테스트 데이터를 보는가(서버 판정 server/data-scope 와 같은 식).
  const envOn = state?.testModeEnabled === true;
  const viewingTest = envOn && state?.testViewInBrowser === true;

  // 테스트 환경이 꺼졌는데 쿠키가 남아 있으면 지운다 — 남겨 두면 누군가 다시 켜는 순간
  // 이 브라우저가 묻지도 않고 테스트 보기로 돌아간다.
  const staleTestView = state !== null && !state.testModeEnabled && state.testViewInBrowser;
  // 쿠키만 지운다 — 화면은 이미 꺼진 모양이고, 상태의 testViewInBrowser 는 다음 조회가 false 로 맞춘다.
  useEffect(() => {
    if (staleTestView) writeTestViewCookie(surveyId, false);
  }, [staleTestView, surveyId]);

  const setBrowserTestView = (on: boolean) => {
    writeTestViewCookie(surveyId, on);
    controlRequestVersion.current += 1;
    setState((current) => {
      const next = current ? { ...current, testViewInBrowser: on } : current;
      stateRef.current = next;
      return next;
    });
    router.refresh();
  };

  const buildAnonymousTestLink = (token: string, identifier: string) =>
    `${window.location.origin}/survey/${identifier}?test=${token}`;

  const testLink =
    typeof window === 'undefined' || !state
      ? null
      : state.testTargetCount > 0 && state.firstTestInviteCode
        ? `${window.location.origin}/i/${state.firstTestInviteCode}`
        : state.testToken
          ? buildAnonymousTestLink(state.testToken, state.accessIdentifier ?? surveyId)
          : null;

  const refreshControl = async () => {
    const requestVersion = ++controlRequestVersion.current;
    const next = await client.operations.control.get({ surveyId });
    if (requestVersion !== controlRequestVersion.current) return null;
    if (!next) return null; // 미저장/삭제 설문
    const controlState = toTestModeState(next);
    if (hasSameTestModeState(stateRef.current, controlState)) return controlState;
    stateRef.current = controlState;
    setState(controlState);
    router.refresh();
    return controlState;
  };

  const enableMutation = useMutation({
    mutationFn: async () => {
      const result = await client.operations.control.setTestMode({ surveyId, enabled: true });
      controlRequestVersion.current += 1;
      return result;
    },
    onSuccess: async (result) => {
      const next = toTestModeState(result);
      stateRef.current = next;
      setState(next);
      // 발견성: 켜는 즉시 링크를 클립보드에 복사해준다. 클립보드 권한 실패(비HTTPS 등) 시
      // 호버 메뉴 안내로 폴백 — 켜짐 자체는 성공이므로 success 토스트 유지.
      if (result.testToken) {
        try {
          await navigator.clipboard.writeText(
            buildAnonymousTestLink(result.testToken, result.accessIdentifier),
          );
          toast.success('테스트 모드가 켜졌습니다. 테스트 링크를 클립보드에 복사했습니다.');
        } catch {
          toast.success('테스트 모드가 켜졌습니다. 메뉴에서 테스트 링크를 복사할 수 있습니다.');
        }
      }
      router.refresh();
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, '테스트 모드 전환에 실패했습니다.'));
    },
  });
  // 테스트 모드를 켜도 이 브라우저의 테스트 데이터 보기는 켜지 않는다 — 보기는 메뉴에서 따로 켠다.
  const enableTestMode = () => {
    controlRequestVersion.current += 1;
    enableMutation.mutate();
  };

  const toggleTestView = () => {
    const on = !viewingTest;
    setBrowserTestView(on);
    toast.success(
      on
        ? '이 브라우저에서 테스트 데이터를 봅니다.'
        : '이 브라우저는 실데이터 화면으로 돌아왔습니다. 테스트 모드는 켜진 채로 남습니다.',
    );
  };

  // 테스트 대상자는 테스트 데이터 쪽에 만들어진다(서버가 이 브라우저의 보기로 파티션을 정한다).
  // 실데이터를 보는 채로 만들면 막히므로 보기를 먼저 켠다.
  const openGenerator = () => {
    setTestMenuOpen(false);
    if (!viewingTest) setBrowserTestView(true);
    setGeneratorOpen(true);
  };

  const requestDisableTestMode = () => {
    setTestMenuOpen(false);
    setTestOffConfirm(true);
  };

  /**
   * 실제 OFF 처리. 성공 시에만 확인 다이얼로그를 닫고,
   * 실패 시 다이얼로그를 유지한 채 toast 만 띄워 재시도 경로를 남긴다.
   */
  const disableMutation = useMutation({
    mutationFn: async (disposition: 'keep' | 'delete') => {
      const result = await client.operations.control.disable({ surveyId, disposition });
      controlRequestVersion.current += 1;
      return { result, disposition };
    },
    onSuccess: ({ result, disposition }) => {
      writeTestViewCookie(surveyId, false);
      const next = {
        ...(stateRef.current ?? {
          testModeEnabled: false,
          testViewInBrowser: false,
          testToken: null,
          accessIdentifier: surveyId,
          testResponseCount: 0,
          testTargetCount: 0,
          firstTestInviteCode: null,
        }),
        testModeEnabled: false,
        testViewInBrowser: false,
        testResponseCount: result.remainingResponseCount,
        testTargetCount: result.remainingTargetCount,
        firstTestInviteCode:
          disposition === 'delete' ? null : (stateRef.current?.firstTestInviteCode ?? null),
      };
      stateRef.current = next;
      setState(next);
      if (disposition === 'delete') {
        toast.success(
          `테스트 대상자 ${result.deletedTargetCount}명과 응답 ${result.deletedResponseCount}건을 삭제했습니다.`,
        );
      } else {
        toast.success('테스트 데이터를 보관하고 테스트 모드를 껐습니다.');
      }
      setTestOffConfirm(false);
      router.refresh();
    },
    onError: async (err) => {
      const message = getErrorMessage(err, '테스트 모드 전환에 실패했습니다.');
      toast.error(message);
      if (message.includes('TEST_WORKSPACE_DISABLE_STALE')) {
        try {
          const latest = await refreshControl();
          // 중첩 if — 논리연산으로 두면 중첩 try 안의 value block 이라 컴파일러가 막는다.
          if (latest) {
            if (!latest.testModeEnabled) setTestOffConfirm(false);
          }
        } catch {
          // 즉시 조회도 실패하면 dialog를 유지하고 focus/polling에서 다시 동기화한다.
        }
      }
    },
    onSettled: () => {
      disableInFlight.current = false;
    },
  });
  const isPending = enableMutation.isPending || disableMutation.isPending;

  const disableTestMode = (disposition: 'keep' | 'delete') => {
    if (disableInFlight.current) return;
    disableInFlight.current = true;
    controlRequestVersion.current += 1;
    disableMutation.mutate(disposition);
  };

  const copyTestLink = async () => {
    if (!testLink) return;
    try {
      await navigator.clipboard.writeText(testLink);
      toast.success('테스트 링크를 복사했습니다.');
    } catch (err) {
      toast.error(getErrorMessage(err, '클립보드 복사에 실패했습니다.'));
    }
  };

  return (
    <>
      {/* 버튼은 아무 동작이 없고 메뉴만 연다(호버·클릭). modal={false}: 호버 오픈 중 배경 잠금이 없어야 mouseleave 닫힘이 자연스럽다 */}
      <DropdownMenu open={testMenuOpen} onOpenChange={setTestMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || state === null}
            className={
              viewingTest
                ? 'border-amber-600 bg-amber-500 text-white hover:bg-amber-600 hover:text-white'
                : envOn
                  ? 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100'
                  : undefined
            }
            onMouseEnter={openTestMenu}
            onMouseLeave={scheduleTestMenuClose}
            // 호버로 이미 열린 메뉴를 클릭이 다시 닫지 않게 — 기본 동작을 막으면 Radix 가 토글을 건너뛴다.
            onPointerDown={(e) => {
              if (testMenuOpen) e.preventDefault();
            }}
          >
            <FlaskConical className="mr-2 h-4 w-4" />
            {viewingTest ? '테스트 데이터 보는 중' : '테스트 모드'}
            {envOn ? (
              <span
                className={`ml-2 rounded px-1.5 py-0.5 text-[11px] leading-none font-bold text-white ${
                  viewingTest ? 'bg-amber-700' : 'bg-amber-500'
                }`}
              >
                ON
              </span>
            ) : null}
            <ChevronDown className="ml-1 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[340px]"
          onMouseEnter={openTestMenu}
          onMouseLeave={scheduleTestMenuClose}
          // 버튼 위 클릭은 메뉴 바깥 클릭으로 치지 않는다 — 열린 메뉴를 닫지 않게(위 onPointerDown 과 짝).
          onPointerDownOutside={(e) => {
            if (triggerRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
        >
          <ToggleMenuItem
            icon={<Power className="h-4 w-4" />}
            label="테스트 모드"
            hint={envOn ? '모든 사람에게 적용' : '켜면 모든 사람에게 테스트 링크가 열립니다'}
            checked={envOn}
            disabled={isPending}
            onToggle={envOn ? requestDisableTestMode : enableTestMode}
          />
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!envOn || !testLink} onSelect={copyTestLink}>
            <Copy className="mr-2 h-4 w-4" />
            테스트 링크 복사
          </DropdownMenuItem>
          <ToggleMenuItem
            icon={<Eye className="h-4 w-4" />}
            label="테스트 데이터 보기"
            hint={
              envOn && !viewingTest ? '이 브라우저만 · 지금 실데이터를 보는 중' : '이 브라우저만'
            }
            checked={viewingTest}
            disabled={!envOn || isPending}
            onToggle={toggleTestView}
          />
          <DropdownMenuItem
            disabled={!envOn || (state?.testTargetCount ?? 0) > 0}
            onSelect={openGenerator}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            <span className="flex flex-col">
              <span>테스트 조사 대상자 생성</span>
              {envOn && state && state.testTargetCount > 0 ? (
                <span className="text-xs text-slate-500">
                  이미 {state.testTargetCount}명을 만들었습니다
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <TestContactGeneratorDialog
        surveyId={surveyId}
        open={generatorOpen}
        onOpenChange={setGeneratorOpen}
        onCreated={async () => {
          await refreshControl();
        }}
      />

      {/* 테스트 모드 끄기는 데이터 수와 무관하게 항상 세 선택지를 확인한다. */}
      <AlertDialog open={testOffConfirm} onOpenChange={setTestOffConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {state && state.testTargetCount > 0
                ? `테스트 대상자 ${state.testTargetCount}명과 응답 ${state.testResponseCount}건을 삭제할까요?`
                : `테스트 응답 ${state?.testResponseCount ?? 0}건을 삭제할까요?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  테스트 모드에서 수집된 응답은 통계·집계에서 항상 제외됩니다. 삭제하면 복구할 수
                  없으니, 보관하려면 “보관하고 끄기”를 선택하세요.
                </p>
                <p>다른 관리자가 진행 중인 테스트와 발송된 테스트 링크도 중단됩니다.</p>
                <p>
                  테스트 데이터를 모두 삭제하고 진행 중인 발송을 중단합니다. 이미 발송된 메일은
                  취소할 수 없습니다.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>취소</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => disableTestMode('keep')}
            >
              보관하고 끄기
            </Button>
            {/* preventDefault: Radix Action 의 자동 닫힘을 막아 실패 시 다이얼로그를 유지한다 */}
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                disableTestMode('delete');
              }}
            >
              삭제 후 끄기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * 메뉴 안의 켜고 끄는 항목 — 고른 뒤에도 메뉴를 닫지 않는다(스위치가 바뀌는 걸 보게).
 * 스위치는 모양만이고 상태는 menuitemcheckbox 의 aria-checked 로 알린다.
 */
function ToggleMenuItem({
  icon,
  label,
  hint,
  checked,
  disabled,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <DropdownMenuItem
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      onSelect={(e) => {
        e.preventDefault();
        onToggle();
      }}
      className="items-start gap-2"
    >
      <span className="mt-0.5">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{label}</span>
        <span className="text-xs text-slate-500">{hint}</span>
      </span>
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? 'justify-end bg-blue-500' : 'justify-start bg-slate-300'
        }`}
      >
        <span className="h-4 w-4 rounded-full bg-white" />
      </span>
    </DropdownMenuItem>
  );
}
