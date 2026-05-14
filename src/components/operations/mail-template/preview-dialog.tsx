'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { AlertTriangle, CheckCircle2, Loader2, Send } from 'lucide-react';

import {
  getMailPreviewSampleAction,
  type MailPreviewSample,
} from '@/actions/mail-template-preview-actions';
import { sendTestTemplateMailAction } from '@/actions/mail-template-test-send-actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MailAttachment } from '@/db/schema/schema-types';
import { TMP_ATTACHMENT_PREFIX } from '@/lib/mail/constants';
import { renderMailPreview, type PreviewSample } from '@/lib/mail/render-preview';
import { sanitizeRichHtml } from '@/lib/sanitize';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surveyId: string;
  subject: string;
  bodyHtml: string;
  fromName: string;
  fromLocal: string;
  fromDomain: string;
  replyTo: string;
  attachments: MailAttachment[];
  currentUserEmail: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SendState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent'; to: string; id?: string }
  | { status: 'error'; message: string };

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; sample: MailPreviewSample | null }
  | { status: 'error'; error: string };

const IFRAME_RESET_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #1f2937;
    padding: 20px;
    background: #ffffff;
  }
  p { margin: 0 0 0.75em 0; }
  p:last-child { margin-bottom: 0; }
  ul { list-style: disc; padding-left: 24px; margin: 0.5em 0; }
  ol { list-style: decimal; padding-left: 24px; margin: 0.5em 0; }
  li { margin: 0.2em 0; }
  table { border-collapse: collapse; margin: 0.5em 0; }
  td, th { border: 1px solid #d1d5db; padding: 4px 8px; }
  img { max-width: 100%; height: auto; }
  a { color: #2563eb; }
`;

function buildIframeSrcDoc(bodyHtml: string): string {
  const safe = sanitizeRichHtml(bodyHtml);
  const content = safe.trim() === ''
    ? '<div style="color:#9ca3af;font-style:italic;">(본문 없음)</div>'
    : safe;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${IFRAME_RESET_CSS}</style></head><body>${content}</body></html>`;
}

export function MailPreviewDialog({
  open,
  onOpenChange,
  surveyId,
  subject,
  bodyHtml,
  fromName,
  fromLocal,
  fromDomain,
  replyTo,
  attachments,
  currentUserEmail,
}: Props) {
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'idle' });
  const [iframeHeight, setIframeHeight] = useState(320);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [testTo, setTestTo] = useState(currentUserEmail);
  const [sendState, setSendState] = useState<SendState>({ status: 'idle' });

  // 다이얼로그 열릴 때마다 default 수신자를 본인 이메일로 리셋 + 발송 상태 초기화
  useEffect(() => {
    if (open) {
      setTestTo(currentUserEmail);
      setSendState({ status: 'idle' });
    }
  }, [open, currentUserEmail]);

  // 다이얼로그 열릴 때마다 fresh 하게 컨택 샘플 fetch
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFetchState({ status: 'loading' });
    getMailPreviewSampleAction(surveyId)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setFetchState({ status: 'error', error: res.error ?? '샘플 컨택을 불러오지 못했습니다' });
          return;
        }
        setFetchState({ status: 'ready', sample: res.data ?? null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFetchState({
          status: 'error',
          error: err instanceof Error ? err.message : '샘플 컨택을 불러오지 못했습니다',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, surveyId]);

  // 샘플 → PreviewSample (inviteUrl 은 서버에서 NEXT_PUBLIC_APP_URL 기준으로 빌드된 값)
  const previewSample = useMemo<PreviewSample | null>(() => {
    if (fetchState.status !== 'ready' || !fetchState.sample) return null;
    return {
      attrs: fetchState.sample.attrs,
      email: fetchState.sample.email,
      inviteUrl: fetchState.sample.inviteUrl,
    };
  }, [fetchState]);

  const rendered = useMemo(
    () =>
      renderMailPreview({
        subject,
        bodyHtml,
        fromName,
        sample: previewSample,
      }),
    [subject, bodyHtml, fromName, previewSample],
  );

  const srcDoc = useMemo(() => buildIframeSrcDoc(rendered.bodyHtml), [rendered.bodyHtml]);

  const fromEmail = fromLocal ? `${fromLocal}@${fromDomain}` : `(이메일 미설정)@${fromDomain}`;
  const toEmail = previewSample?.email ?? null;

  const onIframeLoad = () => {
    const ifr = iframeRef.current;
    if (!ifr || !ifr.contentDocument) return;
    // iframe 내부 스크롤이 생기지 않도록 콘텐츠 자연 높이로 늘리고
    // 외부 다이얼로그 컨테이너 한 곳에서만 스크롤 처리 (스크롤바 중첩 방지)
    const h = ifr.contentDocument.body.scrollHeight;
    setIframeHeight(Math.max(h + 16, 240));
  };

  const isReady = fetchState.status === 'ready';
  const isEmpty = isReady && fetchState.sample === null;

  const toIsValid = EMAIL_RE.test(testTo.trim());
  const hasUnpromotedAttachment = attachments.some((a) =>
    a.key.startsWith(TMP_ATTACHMENT_PREFIX),
  );
  // 샘플 fetch 실패 상태에서는 변수 치환이 불완전하므로 발송 차단.
  const sampleFetchFailed = fetchState.status === 'error';
  const canSend =
    toIsValid &&
    subject.trim().length > 0 &&
    fromLocal.trim().length > 0 &&
    fromName.trim().length > 0 &&
    EMAIL_RE.test(replyTo.trim()) &&
    !hasUnpromotedAttachment &&
    !sampleFetchFailed &&
    sendState.status !== 'sending';

  const onSendTest = async () => {
    setSendState({ status: 'sending' });
    const res = await sendTestTemplateMailAction({
      surveyId,
      to: testTo.trim(),
      subject,
      bodyHtml,
      fromName,
      fromLocal,
      replyTo,
      attachments,
    });
    if (res.ok) {
      setSendState({ status: 'sent', to: testTo.trim(), id: res.id });
    } else {
      setSendState({ status: 'error', message: res.error ?? '발송 실패' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col p-0 gap-0">
        <DialogHeader className="border-b border-gray-200 px-6 pt-6 pb-4">
          <DialogTitle>받는 사람 기준 미리보기</DialogTitle>
          <DialogDescription>
            {isReady
              ? isEmpty
                ? '샘플 컨택이 없습니다. 모든 변수가 (없는 키)로 표시됩니다.'
                : `첫 번째 컨택 (resid #${fetchState.sample!.resid}) 데이터로 변수를 치환했습니다.`
              : '컨택 샘플을 불러오는 중...'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {fetchState.status === 'loading' && (
            <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>샘플 컨택을 불러오는 중...</span>
            </div>
          )}

          {fetchState.status === 'error' && (
            <div className="m-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">샘플 컨택을 불러오지 못했습니다</div>
                <div className="mt-0.5 text-xs">{fetchState.error}</div>
              </div>
            </div>
          )}

          {isReady && (
            <div className="space-y-0">
              {isEmpty && (
                <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>이 설문에 등록된 컨택이 없어 모든 변수가 (없는 키)로 표시됩니다.</span>
                </div>
              )}

              {/* 메일 헤더: From / To / 제목 */}
              <dl className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5 border-b border-gray-200 bg-gray-50 px-6 py-4 text-sm">
                <dt className="text-gray-500">From</dt>
                <dd className="text-gray-900">
                  <span dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(rendered.fromName) || '<span style="color:#9ca3af;font-style:italic;">(이름 없음)</span>' }} />{' '}
                  <span className="text-gray-500">&lt;{fromEmail}&gt;</span>
                </dd>

                <dt className="text-gray-500">To</dt>
                <dd className="text-gray-900">
                  {toEmail ? (
                    toEmail
                  ) : (
                    <span className="italic text-gray-400">(이메일 없음)</span>
                  )}
                </dd>

                <dt className="text-gray-500">제목</dt>
                <dd
                  className="font-medium text-gray-900"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeRichHtml(rendered.subject) || '<span style="color:#9ca3af;font-style:italic;">(제목 없음)</span>',
                  }}
                />
              </dl>

              {/* 본문 — iframe 으로 페이지 CSS 격리 */}
              <iframe
                ref={iframeRef}
                title="메일 본문 미리보기"
                sandbox="allow-same-origin"
                srcDoc={srcDoc}
                onLoad={onIframeLoad}
                style={{ height: `${iframeHeight}px` }}
                className="w-full border-0"
              />
            </div>
          )}
        </div>

        {/* 테스트 발송 — 다이얼로그 하단 sticky 섹션 */}
        <div className="shrink-0 border-t border-gray-200 bg-gray-50 px-6 py-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
            <Send className="h-4 w-4 text-gray-500" />
            테스트 발송
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="test-to" className="text-xs text-gray-600">
                받는 사람
              </Label>
              <Input
                id="test-to"
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="you@example.com"
                value={testTo}
                onChange={(e) => {
                  setTestTo(e.target.value);
                  if (sendState.status !== 'idle' && sendState.status !== 'sending') {
                    setSendState({ status: 'idle' });
                  }
                }}
                disabled={sendState.status === 'sending'}
                className="h-9 bg-white"
              />
            </div>
            <Button
              type="button"
              onClick={onSendTest}
              disabled={!canSend}
              className="h-9 shrink-0"
            >
              {sendState.status === 'sending' ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  발송 중…
                </>
              ) : (
                <>
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  테스트 발송
                </>
              )}
            </Button>
          </div>

          <p className="mt-2 text-xs text-gray-500">
            제목 앞에 <code className="rounded bg-gray-200 px-1 text-[11px]">[TEST]</code>
            가 자동으로 붙고, 본문 내 설문 링크는 응답되지 않는 미리보기용 토큰으로
            치환됩니다.
          </p>

          {hasUnpromotedAttachment && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div>
                저장하지 않은 첨부가 있어 발송할 수 없습니다. 다이얼로그를 닫고 먼저 저장해 주세요.
              </div>
            </div>
          )}

          {sendState.status === 'sent' && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div>
                  <span className="font-medium">{sendState.to}</span> 로 발송 완료
                </div>
                {sendState.id && (
                  <div className="mt-0.5 font-mono text-[11px] text-emerald-700 break-all">
                    id: {sendState.id}
                  </div>
                )}
              </div>
            </div>
          )}

          {sendState.status === 'error' && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium">발송 실패</div>
                <div className="mt-0.5 text-xs">{sendState.message}</div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
