'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';
import { Copy, FlaskConical } from 'lucide-react';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getErrorMessage } from '@/lib/get-error-message';
import { client } from '@/shared/lib/rpc';

interface TestModeState {
  testModeEnabled: boolean;
  testToken: string | null;
  accessIdentifier: string;
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
 * 켜면 `/survey/{surveyId}?test={token}` 링크가 활성화되어 중단/중복 게이트를 우회하고
 * 응답이 `survey_responses.isTest=true` 로 적재된다(집계 제외). 켜는 즉시 링크를
 * 클립보드에 복사하고, ON 상태에서는 amber 버튼 호버/클릭 드롭다운으로 링크 복사·끄기 제공.
 * 테스트 링크는 마지막 발행본(스냅샷) 기준 — 편집 중 미발행 내용은 반영되지 않는다.
 */
export function TestModeControl({ surveyId, initial }: Props) {
  const router = useRouter();
  const [state, setState] = useState<TestModeState | null>(initial ?? null);
  const [isPending, startTransition] = useTransition();
  const [testOffConfirm, setTestOffConfirm] = useState<{ count: number } | null>(null);

  // initial 미제공(편집 페이지) 시 마운트에서 현재 상태 조회
  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    client.operations.control
      .get({ surveyId })
      .then((row) => {
        if (cancelled) return;
        setState({
          testModeEnabled: row.testModeEnabled,
          testToken: row.testToken,
          accessIdentifier: row.accessIdentifier,
        });
      })
      .catch(() => {
        // 조회 실패 시 버튼은 OFF 모양으로 폴백 — 클릭 시 토글 시도에서 에러 안내
        if (cancelled) return;
        setState({ testModeEnabled: false, testToken: null, accessIdentifier: surveyId });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyId]);

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

  const buildTestLink = (token: string, identifier: string) =>
    `${window.location.origin}/survey/${identifier}?test=${token}`;

  const testLink =
    typeof window !== 'undefined' && state?.testToken
      ? buildTestLink(state.testToken, state.accessIdentifier ?? surveyId)
      : null;

  const enableTestMode = () =>
    startTransition(async () => {
      try {
        const result = await client.operations.control.setTestMode({ surveyId, enabled: true });
        setState((s) => ({
          ...(s ?? { testModeEnabled: false, testToken: null, accessIdentifier: surveyId }),
          ...result,
        }));
        // 발견성: 켜는 즉시 링크를 클립보드에 복사해준다. 클립보드 권한 실패(비HTTPS 등) 시
        // 호버 메뉴 안내로 폴백 — 켜짐 자체는 성공이므로 success 토스트 유지.
        if (result.testToken) {
          try {
            await navigator.clipboard.writeText(buildTestLink(result.testToken, result.accessIdentifier));
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

  const requestDisableTestMode = () =>
    startTransition(async () => {
      try {
        const { testResponseCount } = await client.operations.control.get({ surveyId });
        if (testResponseCount > 0) {
          setTestOffConfirm({ count: testResponseCount });
        } else {
          await disableTestMode(false);
        }
      } catch (err) {
        toast.error(getErrorMessage(err, '테스트 모드 상태 조회에 실패했습니다.'));
      }
    });

  /**
   * 실제 OFF 처리. 성공 시에만 setTestOffConfirm(null) 로 확인 다이얼로그를 닫고,
   * 실패 시 다이얼로그를 유지한 채 toast 만 띄워 재시도 경로를 남긴다.
   * plain async 로 둔 이유: requestDisableTestMode 의 transition 안에서 await 가 유효해야
   * isPending 이 이 작업 완료까지 이어진다. 다이얼로그 버튼 호출부는 각자 startTransition 으로 감싼다.
   */
  const disableTestMode = async (deleteResponses: boolean) => {
    try {
      if (deleteResponses) {
        const { deletedCount } = await client.operations.control.deleteTestResponses({
          surveyId,
        });
        toast.success(`테스트 응답 ${deletedCount}건을 삭제했습니다.`);
      }
      const result = await client.operations.control.setTestMode({ surveyId, enabled: false });
      setState((s) => ({
        ...(s ?? { testModeEnabled: false, testToken: null, accessIdentifier: surveyId }),
        ...result,
      }));
      setTestOffConfirm(null);
      router.refresh();
    } catch (err) {
      toast.error(getErrorMessage(err, '테스트 모드 전환에 실패했습니다.'));
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

      {/* 테스트 모드 끄기 확인 — 삭제되지 않은 테스트 응답이 있을 때만 뜬다 */}
      <AlertDialog
        open={testOffConfirm !== null}
        onOpenChange={(open) => !open && setTestOffConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>테스트 응답 {testOffConfirm?.count}건을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              테스트 모드에서 수집된 응답은 통계·집계에서 항상 제외됩니다. 삭제하면 복구할 수
              없으니, 보관하려면 &ldquo;보관하고 끄기&rdquo;를 선택하세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>취소</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => startTransition(() => disableTestMode(false))}
            >
              보관하고 끄기
            </Button>
            {/* preventDefault: Radix Action 의 자동 닫힘을 막아 실패 시 다이얼로그를 유지한다 */}
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                startTransition(() => disableTestMode(true));
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
