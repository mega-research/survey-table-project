'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { AlertTriangle, Loader2, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { MailPreviewSample } from '@/features/mail/domain/mail-preview';
import { renderMailPreview, type PreviewSample } from '@/lib/mail/render-preview';
import { sanitizeRichHtml } from '@/lib/sanitize';
import { client } from '@/shared/lib/rpc';

export interface MailTemplateOption {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  fromName: string;
}

interface Props {
  surveyId: string;
  contactTargetId: string;
  templates: MailTemplateOption[];
  /** null 이면 발송 가능. 문자열이면 버튼 대신 사유만 표시. */
  disabledReason: string | null;
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; sample: MailPreviewSample | null }
  | { status: 'error'; error: string };

// preview-dialog.tsx 와 동일한 iframe 리셋 스타일 — 메일 클라이언트 CSS 격리 재현.
const IFRAME_RESET_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html { background: #f9fafb; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #1f2937;
    max-width: 900px;
    margin: 0 auto;
    padding: 24px 16px;
    background: #ffffff;
  }
  p { margin: 0 0 0.5em 0; }
  p:last-child { margin-bottom: 0; }
  ul { list-style: disc; padding-left: 24px; margin: 0.5em 0; }
  ol { list-style: decimal; padding-left: 24px; margin: 0.5em 0; }
  li { margin: 0.2em 0; }
  table { border-collapse: collapse; margin: 0.5em 0; }
  td, th { border: 1px solid #d1d5db; padding: 4px 8px; }
  img { max-width: 100%; height: auto; }
  p img { float: none !important; display: inline-block; vertical-align: top; }
  a { color: #2563eb; }
`;

function buildIframeSrcDoc(bodyHtml: string): string {
  const safe = sanitizeRichHtml(bodyHtml);
  const content =
    safe.trim() === ''
      ? '<div style="color:#9ca3af;font-style:italic;">(본문 없음)</div>'
      : safe;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${IFRAME_RESET_CSS}</style></head><body>${content}</body></html>`;
}

/** 컨택 상세 카드에서 단건으로 메일을 발송하는 다이얼로그. */
export function SendSingleMailDialog({
  surveyId,
  contactTargetId,
  templates,
  disabledReason,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'idle' });
  const [sendError, setSendError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 다이얼로그 열릴 때마다 fresh 하게 샘플 fetch (닫혀 있는 동안 컨택 정보가 바뀔 수 있음)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setFetchState({ status: 'loading' });
    });
    client.mail.preview
      .sample({ surveyId, contactTargetId })
      .then((sample) => {
        if (cancelled) return;
        setFetchState({ status: 'ready', sample });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFetchState({
          status: 'error',
          error: err instanceof Error ? err.message : '미리보기 데이터를 불러오지 못했습니다.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, surveyId, contactTargetId]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // 다음에 다시 열 때 이전 선택/에러가 남지 않도록 초기화
      setTemplateId('');
      setSendError(null);
      setFetchState({ status: 'idle' });
    }
  }

  const selected = templates.find((t) => t.id === templateId) ?? null;
  const sample = fetchState.status === 'ready' ? fetchState.sample : null;

  const previewSample = useMemo<PreviewSample | null>(() => {
    if (!sample) return null;
    return { attrs: sample.attrs, email: sample.email, inviteUrl: sample.inviteUrl };
  }, [sample]);

  const rendered = useMemo(() => {
    if (!selected) return null;
    return renderMailPreview({
      subject: selected.subject,
      bodyHtml: selected.bodyHtml,
      fromName: selected.fromName,
      sample: previewSample,
      mode: 'preview',
    });
  }, [selected, previewSample]);

  const srcDoc = useMemo(
    () => (rendered ? buildIframeSrcDoc(rendered.bodyHtml) : null),
    [rendered],
  );

  const isReady = fetchState.status === 'ready';
  const sampleFetchFailed = fetchState.status === 'error';
  const toEmail = previewSample?.email ?? null;
  const canSend = selected != null && isReady && !sampleFetchFailed && !isPending;

  function handleSend() {
    if (!selected) return;
    setSendError(null);
    startTransition(async () => {
      try {
        await client.mail.campaigns.sendSingle({
          surveyId,
          contactTargetId,
          mailTemplateId: selected.id,
        });
        onOpenChange(false);
        router.refresh();
      } catch (e) {
        setSendError(e instanceof Error ? e.message : '발송에 실패했습니다.');
      }
    });
  }

  if (disabledReason) {
    return (
      <span className="text-xs text-slate-400" title={disabledReason}>
        {disabledReason}
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(e) => {
            // summary(details toggle) 안에 버튼이 있어 클릭이 부모로 버블링되면
            // 다이얼로그가 열리는 동시에 접힘 카드가 토글돼 버림 — 버블링만 차단하고
            // DialogTrigger 자체의 open 토글(같은 엘리먼트, 버블링 이전에 실행됨)은 그대로 둔다.
            e.stopPropagation();
          }}
        >
          메일 보내기
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-[720px] flex-col p-0 gap-0">
        <DialogHeader className="border-b border-gray-200 px-6 pt-6 pb-4">
          <DialogTitle>단건 메일 발송</DialogTitle>
          <DialogDescription>
            이 조사 대상에게만 개별로 메일을 발송합니다. 발송 이력에 &ldquo;단건&rdquo;으로 기록됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-1.5">
            <label htmlFor="single-mail-template" className="text-xs text-gray-600">
              템플릿
            </label>
            <select
              id="single-mail-template"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">템플릿 선택</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {fetchState.status === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>수신자 정보를 불러오는 중...</span>
            </div>
          )}

          {fetchState.status === 'error' && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">수신자 정보를 불러오지 못했습니다</div>
                <div className="mt-0.5 text-xs">{fetchState.error}</div>
              </div>
            </div>
          )}

          {isReady && sample === null && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>이 조사 대상의 수신자 정보를 확인할 수 없습니다.</span>
            </div>
          )}

          {isReady && sample != null && (
            <p className="mt-3 text-xs text-gray-500">
              수신: {toEmail ?? <span className="italic text-gray-400">(이메일 없음)</span>}
            </p>
          )}

          {selected && rendered && srcDoc && (
            <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
              <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-900">
                {rendered.subject || (
                  <span className="italic text-gray-400">(제목 없음)</span>
                )}
              </div>
              <iframe
                title="메일 본문 미리보기"
                sandbox="allow-same-origin"
                srcDoc={srcDoc}
                className="h-72 w-full border-0"
              />
            </div>
          )}

          {sendError && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>{sendError}</div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-gray-200 bg-gray-50 px-6 py-4">
          <div className="flex justify-end">
            <Button type="button" onClick={handleSend} disabled={!canSend}>
              {isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  발송 중...
                </>
              ) : (
                <>
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  발송
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
