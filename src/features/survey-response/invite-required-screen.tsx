'use client';

import { Lock } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { DEFAULT_SURVEY_LOCALE, type SurveyLocale } from '@/types/survey-locale';

import { SystemText } from './system-text';

/** 다국어 설문이면 현재 언어, 미정(`null`)이면 세 언어를 함께 보인다(CONTEXT.md 「다국어 설문」). */
export function InviteRequiredScreen({
  locale = DEFAULT_SURVEY_LOCALE,
}: {
  locale?: SurveyLocale | null;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <Card className="mx-auto max-w-md">
        <CardContent className="p-8 text-center">
          <Lock className="mx-auto mb-4 h-12 w-12 text-yellow-500" />
          <h2 className="mb-2 text-xl font-semibold text-gray-900">
            <SystemText k="screen.inviteRequired.title" locale={locale} />
          </h2>
          <p className="text-gray-600">
            <SystemText k="screen.inviteRequired.body" locale={locale} />
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
