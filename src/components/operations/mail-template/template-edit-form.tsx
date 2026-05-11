'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  createMailTemplateAction,
  updateMailTemplateAction,
} from '@/actions/mail-template-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import type { MailTemplate } from '@/db/schema/mail';

import { MailTemplateEditor } from './mail-template-editor';
import { MetaFields, type MetaFieldValues } from './meta-fields';
import type { VariableDef } from './variable-catalog';

interface Props {
  surveyId: string;
  fromDomain: string;
  catalog: VariableDef[];
  template?: MailTemplate;
}

interface FormState extends MetaFieldValues {
  bodyHtml: string;
}

function buildInitialState(template?: MailTemplate): FormState {
  return {
    name: template?.name ?? '',
    subject: template?.subject ?? '',
    fromLocal: template?.fromLocal ?? '',
    fromName: template?.fromName ?? '',
    replyTo: template?.replyTo ?? '',
    bodyHtml: template?.bodyHtml ?? '',
  };
}

export function TemplateEditForm({ surveyId, fromDomain, catalog, template }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial = useMemo(() => buildInitialState(template), [template]);
  const [state, setState] = useState<FormState>(initial);

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
    state.replyTo.trim().length > 0;

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
        attachments: template?.attachments ?? [],
      };

      const result = template
        ? await updateMailTemplateAction(surveyId, template.id, input)
        : await createMailTemplateAction(surveyId, input);

      if (!result.ok) {
        setError(result.error ?? '저장 실패');
        return;
      }
      router.push(`/admin/surveys/${surveyId}/operations/mail-templates`);
      router.refresh();
    });
  };

  const onCancel = () => {
    if (isDirty && !confirm('변경사항이 저장되지 않습니다. 나가시겠습니까?')) return;
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

        <div className="space-y-2">
          <Label className="text-sm font-medium text-gray-900">
            본문<span className="ml-0.5 text-red-500">*</span>
          </Label>
          <MailTemplateEditor
            initialHtml={template?.bodyHtml ?? ''}
            catalog={catalog}
            onChange={(html) => setState((prev) => ({ ...prev, bodyHtml: html }))}
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-gray-100 pt-6">
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            취소
          </Button>
          <Button type="button" onClick={onSave} disabled={pending || !canSave}>
            {pending ? '저장 중...' : '저장'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
