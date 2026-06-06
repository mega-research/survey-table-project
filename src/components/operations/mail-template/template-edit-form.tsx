'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import type { MailTemplate } from '@/db/schema/mail';
import type { MailAttachment } from '@/db/schema/schema-types';
import { TMP_ATTACHMENT_PREFIX } from '@/lib/mail/constants';
import { deleteMailAttachmentTmpBatch } from '@/lib/mail/mail-attachment-client';
import { client } from '@/shared/lib/rpc';

import { AttachmentSection } from './attachment-section';
import { RichTextEditor, type RichTextEditorHandle } from '@/components/ui/rich-text-editor';
import { MetaFields, type MetaFieldValues } from './meta-fields';
import { MailPreviewDialog } from './preview-dialog';
import type { VariableDef } from './variable-catalog';

interface Props {
  surveyId: string;
  fromDomain: string;
  catalog: VariableDef[];
  template?: MailTemplate;
  currentUserEmail: string;
}

interface FormState extends MetaFieldValues {
  bodyHtml: string;
  attachments: MailAttachment[];
}

function buildInitialState(template?: MailTemplate): FormState {
  return {
    name: template?.name ?? '',
    subject: template?.subject ?? '',
    fromLocal: template?.fromLocal ?? '',
    fromName: template?.fromName ?? '',
    replyTo: template?.replyTo ?? '',
    bodyHtml: template?.bodyHtml ?? '',
    attachments: template?.attachments ?? [],
  };
}

export function TemplateEditForm({ surveyId, fromDomain, catalog, template, currentUserEmail }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);

  const initial = useMemo(() => buildInitialState(template), [template]);
  const [state, setState] = useState<FormState>(initial);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // 저장 직후 "저장됨" 메시지를 잠깐 띄우고 자동 소멸 — list 로 navigate 안 하므로
  // 사용자가 저장 성공을 인지할 visual cue 가 필요.
  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), 3000);
    return () => clearTimeout(t);
  }, [savedAt]);

  // 저장 안 된 tmp prefix 첨부가 있으면 발송 차단 — 저장이 promote 트리거이므로
  // 미저장 상태에서 발송하면 R2 lifecycle/race 로 NoSuchKey 사고 위험.
  const hasUnpromotedAttachment = useMemo(
    () => state.attachments.some((a) => a.key.startsWith(TMP_ATTACHMENT_PREFIX)),
    [state.attachments],
  );

  const meta: MetaFieldValues = {
    name: state.name,
    subject: state.subject,
    fromLocal: state.fromLocal,
    fromName: state.fromName,
    replyTo: state.replyTo,
  };

  const isDirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(initial),
    [state, initial],
  );

  const canSave =
    state.name.trim().length > 0 &&
    state.subject.trim().length > 0 &&
    state.fromLocal.trim().length > 0 &&
    state.fromName.trim().length > 0 &&
    state.replyTo.trim().length > 0 &&
    !isUploading &&
    !pending;

  // 미리보기/테스트 발송 가능 조건 — 영구 prefix 만 R2 에서 안정적으로 다운로드 가능.
  const canPreview = !pending && !isUploading && !hasUnpromotedAttachment;
  const previewBlockedReason = isUploading
    ? '업로드 중에는 미리보기/발송할 수 없습니다.'
    : hasUnpromotedAttachment
      ? '저장하지 않은 첨부가 있습니다. 먼저 저장한 뒤 발송하세요.'
      : pending
        ? '저장이 끝날 때까지 기다려 주세요.'
        : null;

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const input = {
        ...meta,
        bodyHtml: state.bodyHtml,
        attachments: state.attachments,
      };

      try {
        if (template) {
          const result = await client.mail.templates.update({
            surveyId,
            templateId: template.id,
            input,
          });
          // promote 후 영구 prefix 로 교체된 attachments 를 state 에 반영 —
          // 저장 직후 미리보기 발송에서 stale tmp key 다운로드 race 차단.
          setState((prev) => ({ ...prev, attachments: result.attachments }));
          setSavedAt(Date.now());
          // 기존 템플릿 수정 → server fetch 만 갱신, URL/페이지 그대로 유지.
          router.refresh();
        } else {
          const result = await client.mail.templates.create({ surveyId, input });
          setState((prev) => ({ ...prev, attachments: result.attachments }));
          setSavedAt(Date.now());
          // 신규 생성 → 새 id 의 edit URL 로 자리 잡음 (full page reload 없이 URL 만 교체).
          // 다음 저장은 update 경로로 가도록 함.
          router.replace(
            `/admin/surveys/${surveyId}/operations/mail/templates/${result.id}/edit`,
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '저장 실패');
      }
    });
  };

  const onCancel = () => {
    if (isDirty && !confirm('변경사항이 저장되지 않습니다. 나가시겠습니까?')) return;
    // 저장하지 않고 떠날 때 에디터 이미지 + 첨부 모두 orphan cleanup (best-effort).
    // 네트워크/타이밍 실패는 24h R2 lifecycle 안전망이 처리.
    editorRef.current?.cleanupOrphanImages().catch((err) => {
      console.error('cancel 시 이미지 cleanup 실패:', err);
    });
    deleteMailAttachmentTmpBatch(state.attachments);
    router.back();
  };

  return (
    <Card>
      <CardContent className="space-y-8 p-8 pt-8">
        <MetaFields
          values={meta}
          onChange={(next) => setState((prev) => ({ ...prev, ...next }))}
          fromDomain={fromDomain}
        />

        <AttachmentSection
          attachments={state.attachments}
          onChange={(updater) =>
            setState((prev) => ({ ...prev, attachments: updater(prev.attachments) }))
          }
          onUploadingChange={setIsUploading}
        />

        <div className="space-y-2">
          <Label className="text-sm font-medium text-gray-900">
            본문<span className="ml-0.5 text-red-500">*</span>
          </Label>
          <RichTextEditor
            ref={editorRef}
            kind="mail"
            initialHtml={template?.bodyHtml ?? ''}
            variableCatalog={catalog}
            onChange={(html) => setState((prev) => ({ ...prev, bodyHtml: html }))}
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {previewBlockedReason && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {previewBlockedReason}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-6">
          {savedAt && (
            <span className="mr-2 inline-flex items-center gap-1 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              저장됨
            </span>
          )}
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            취소
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPreviewOpen(true)}
            disabled={!canPreview}
            title={previewBlockedReason ?? undefined}
          >
            미리보기
          </Button>
          <Button type="button" onClick={onSave} disabled={!canSave}>
            {pending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                저장 중...
              </>
            ) : isUploading ? (
              '업로드 중...'
            ) : (
              '저장'
            )}
          </Button>
        </div>
      </CardContent>

      <MailPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        surveyId={surveyId}
        subject={state.subject}
        bodyHtml={state.bodyHtml}
        fromName={state.fromName}
        fromLocal={state.fromLocal}
        fromDomain={fromDomain}
        replyTo={state.replyTo}
        attachments={state.attachments}
        currentUserEmail={currentUserEmail}
      />
    </Card>
  );
}
