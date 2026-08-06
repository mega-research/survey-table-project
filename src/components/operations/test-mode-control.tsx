'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Copy, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';

import { TestContactGeneratorDialog } from '@/components/operations/contacts/test-contact-generator-dialog';
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
import { getErrorMessage } from '@/lib/get-error-message';
import { client } from '@/shared/lib/rpc';

interface TestModeState {
  testModeEnabled: boolean;
  testToken: string | null;
  accessIdentifier: string;
  testResponseCount: number;
  testTargetCount: number;
  firstTestInviteCode: string | null;
}

function toTestModeState(row: TestModeState): TestModeState {
  return {
    testModeEnabled: row.testModeEnabled,
    testToken: row.testToken,
    accessIdentifier: row.accessIdentifier,
    testResponseCount: row.testResponseCount,
    testTargetCount: row.testTargetCount,
    firstTestInviteCode: row.firstTestInviteCode,
  };
}

function hasSameTestModeState(current: TestModeState | null, next: TestModeState): boolean {
  return (
    current !== null &&
    current.testModeEnabled === next.testModeEnabled &&
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
 * 켜면 `/survey/{accessIdentifier}?test={token}` 링크가 활성화되어 중단/중복 게이트를 우회하고
 * 응답이 `survey_responses.isTest=true` 로 적재된다(집계 제외). 켜는 즉시 링크를
 * 클립보드에 복사하고, ON 상태에서는 amber 버튼 호버/클릭 드롭다운으로 링크 복사·끄기 제공.
 * 테스트 링크는 마지막 발행본(스냅샷) 기준 — 편집 중 미발행 내용은 반영되지 않는다.
 */
export function TestModeControl({ surveyId, initial }: Props) {
  const router = useRouter();
  const [state, setState] = useState<TestModeState | null>(initial ?? null);
  const [isPending, startTransition] = useTransition();
  const [testOffConfirm, setTestOffConfirm] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const disableInFlight = useRef(false);
  const stateRef = useRef<TestModeState | null>(initial ?? null);
  const controlRequestVersion = useRef(0);

  // RSC refresh로 initial이 바뀌면 client local state도 같은 snapshot으로 맞춘다.
  useEffect(() => {
    if (initial) {
      controlRequestVersion.current += 1;
      const next = toTestModeState(initial);
      stateRef.current = next;
      setState((current) => (hasSameTestModeState(current, next) ? current : next));
      return;
    }
    let cancelled = false;
    const requestVersion = ++controlRequestVersion.current;
    client.operations.control
      .get({ surveyId })
      .then((row) => {
        if (cancelled || requestVersion !== controlRequestVersion.current) return;
        const next = toTestModeState(row);
        stateRef.current = next;
        setState(next);
      })
      .catch(() => {
        // 조회 실패 시 버튼은 OFF 모양으로 폴백 — 클릭 시 토글 시도에서 에러 안내
        if (cancelled || requestVersion !== controlRequestVersion.current) return;
        const fallback = {
          testModeEnabled: false,
          testToken: null,
          accessIdentifier: surveyId,
          testResponseCount: 0,
          testTargetCount: 0,
          firstTestInviteCode: null,
        };
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
        if (cancelled || requestVersion !== controlRequestVersion.current) return;
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
    const controlState = toTestModeState(next);
    if (hasSameTestModeState(stateRef.current, controlState)) return controlState;
    stateRef.current = controlState;
    setState(controlState);
    router.refresh();
    return controlState;
  };

  const enableTestMode = () =>
    startTransition(async () => {
      controlRequestVersion.current += 1;
      try {
        const result = await client.operations.control.setTestMode({ surveyId, enabled: true });
        controlRequestVersion.current += 1;
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
            toast.success(
              '테스트 모드가 켜졌습니다. 버튼에 마우스를 올리면 테스트 링크를 복사할 수 있습니다.',
            );
          }
        }
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err, '테스트 모드 전환에 실패했습니다.'));
      }
    });

  const requestDisableTestMode = () => {
    setTestMenuOpen(false);
    setTestOffConfirm(true);
  };

  /**
   * 실제 OFF 처리. 성공 시에만 확인 다이얼로그를 닫고,
   * 실패 시 다이얼로그를 유지한 채 toast 만 띄워 재시도 경로를 남긴다.
   */
  const disableTestMode = async (disposition: 'keep' | 'delete') => {
    if (disableInFlight.current) return;
    disableInFlight.current = true;
    controlRequestVersion.current += 1;
    try {
      const result = await client.operations.control.disable({ surveyId, disposition });
      controlRequestVersion.current += 1;
      const next = {
        ...(stateRef.current ?? {
          testModeEnabled: false,
          testToken: null,
          accessIdentifier: surveyId,
          testResponseCount: 0,
          testTargetCount: 0,
          firstTestInviteCode: null,
        }),
        testModeEnabled: false,
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
    } catch (err) {
      const message = getErrorMessage(err, '테스트 모드 전환에 실패했습니다.');
      toast.error(message);
      if (message.includes('TEST_WORKSPACE_DISABLE_STALE')) {
        try {
          const latest = await refreshControl();
          if (latest && !latest.testModeEnabled) setTestOffConfirm(false);
        } catch {
          // 즉시 조회도 실패하면 dialog를 유지하고 focus/polling에서 다시 동기화한다.
        }
      }
    } finally {
      disableInFlight.current = false;
    }
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
      {state?.testModeEnabled ? (
        // modal={false}: 호버 오픈 중 배경 pointer-events 잠금이 없어야 mouseleave 닫힘이 자연스럽다
        <DropdownMenu open={testMenuOpen} onOpenChange={setTestMenuOpen} modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              className="border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
              onMouseEnter={openTestMenu}
              onMouseLeave={scheduleTestMenuClose}
            >
              <FlaskConical className="mr-2 h-4 w-4" />
              테스트 모드
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onMouseEnter={openTestMenu}
            onMouseLeave={scheduleTestMenuClose}
          >
            <DropdownMenuItem disabled={!testLink} onSelect={copyTestLink}>
              <Copy className="mr-2 h-4 w-4" />
              테스트 링크 복사
            </DropdownMenuItem>
            {state.testTargetCount === 0 ? (
              <DropdownMenuItem onSelect={() => setGeneratorOpen(true)}>
                테스트 대상자 생성
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={isPending} onSelect={requestDisableTestMode}>
              테스트 모드 끄기
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending || state === null}
          onClick={enableTestMode}
        >
          <FlaskConical className="mr-2 h-4 w-4" />
          테스트 모드
        </Button>
      )}

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
              onClick={() => startTransition(() => disableTestMode('keep'))}
            >
              보관하고 끄기
            </Button>
            {/* preventDefault: Radix Action 의 자동 닫힘을 막아 실패 시 다이얼로그를 유지한다 */}
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                startTransition(() => disableTestMode('delete'));
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
