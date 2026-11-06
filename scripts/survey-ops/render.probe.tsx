/**
 * `pnpm survey:render` 가 vitest(jsdom)로 돌리는 그리기 — 관리자 「설문 보기」와 같은 컴포넌트·같은 입력이다
 * (`SurveyResponseFlow mode="preview"` + previewContext). 테스트가 아니라 출력기라 단언하지 않는다.
 *
 * 입력은 env 로 받는다: SURVEY_OPS_DUMP(dump 파일) · SURVEY_OPS_OUT(결과 파일) · SURVEY_OPS_MOBILE · SURVEY_OPS_NEXT.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import type { Survey } from '@/types/survey';

import { stubMatchMedia } from '../../tests/helpers/image-size';
import { outlinePage } from './outline';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/surveys/preview',
  useSearchParams: () => new URLSearchParams(),
}));

const NEXT_LABELS = ['다음', '下一步', 'Next'];

interface Dump {
  surveyId: string;
  source: string;
  versionId: string | null;
  documentView: unknown;
  survey: Survey;
  contact: { resid: number; isTest: boolean } | null;
  contactAttrs: Record<string, string> | null;
  priorAnswers: unknown;
}

function reviveSurvey(raw: Survey): Survey {
  const s = raw as Survey & { createdAt: unknown; updatedAt: unknown };
  return {
    ...s,
    createdAt: new Date(String(s.createdAt)),
    updatedAt: new Date(String(s.updatedAt)),
  } as Survey;
}

/** 글자가 두 번 연속 같아질 때까지 기다린다(이월 프리필·토큰 치환이 effect 뒤에 들어온다). */
async function settle(root: HTMLElement) {
  let last = '';
  let stable = 0;
  for (let i = 0; i < 60 && stable < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const now = root.innerHTML;
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
}

function findNextButton(root: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
  return (
    buttons.find((b) => NEXT_LABELS.includes((b.textContent ?? '').trim()) && !b.disabled) ?? null
  );
}

afterAll(() => cleanup());

it('render', async () => {
  const dumpPath = process.env['SURVEY_OPS_DUMP'];
  const outPath = process.env['SURVEY_OPS_OUT'];
  if (!dumpPath || !outPath)
    throw new Error(
      'SURVEY_OPS_DUMP · SURVEY_OPS_OUT 이 없습니다 — pnpm survey:render 로 실행하세요',
    );
  const mobile = process.env['SURVEY_OPS_MOBILE'] === '1';
  const nextCount = Number(process.env['SURVEY_OPS_NEXT'] ?? '0');
  const dump = JSON.parse(readFileSync(dumpPath, 'utf8')) as Dump;

  stubMatchMedia({ mobile, hover: !mobile });
  const { container } = render(
    <SurveyResponseFlow
      mode="preview"
      surveyIdentifier={dump.surveyId}
      previewContext={{
        survey: reviveSurvey(dump.survey),
        versionId: dump.versionId,
        documentView: (dump.documentView ?? null) as never,
        ...(dump.contactAttrs ? { contactAttrs: dump.contactAttrs } : {}),
        ...(dump.priorAnswers != null ? { priorAnswers: dump.priorAnswers } : {}),
      }}
    />,
  );
  await settle(container);

  const sections: string[] = [];
  const header = [
    `# ${dump.survey.title} — ${dump.source === 'published' ? '배포본' : '저장본'} · ${mobile ? '모바일(<768px)' : '데스크톱'}`,
    `# 명단 값: ${dump.contact ? `${dump.contact.isTest ? '테스트 ' : ''}조사 대상 #${dump.contact.resid}` : '없음'}`,
    '# CSS 는 계산하지 않는다 — hidden·aria-hidden·인라인 display:none·Tailwind 화면 폭 클래스만 숨김으로 본다',
  ].join('\n');
  sections.push(header);
  sections.push(`## 1쪽\n${outlinePage(container, { mobile })}`);

  for (let i = 1; i <= nextCount; i++) {
    const next = findNextButton(container);
    if (!next) {
      sections.push(`## 「다음」 버튼이 없어 멈춤 (${i}번째)`);
      break;
    }
    const beforeLines = outlinePage(container, { mobile }).split('\n');
    fireEvent.click(next);
    await settle(container);
    const text = outlinePage(container, { mobile });
    const afterLines = text.split('\n');
    // 앞 쪽의 줄이 전부 남아 있으면 넘어가지 못한 것이다 — 새로 생긴 줄(오류 문구)만 찍는다.
    const kept = new Set(afterLines);
    if (beforeLines.every((line) => kept.has(line))) {
      const prev = new Set(beforeLines);
      const added = afterLines.filter((line) => !prev.has(line));
      sections.push(
        `## 「다음」 ${i}번째 — 막힘, 같은 쪽에 머묾\n${added.length > 0 ? added.join('\n') : '(새로 생긴 글자 없음)'}`,
      );
      break;
    }
    sections.push(`## 「다음」 ${i}번 뒤\n${text}`);
  }

  writeFileSync(outPath, `${sections.join('\n\n')}\n`);
}, 120_000);
