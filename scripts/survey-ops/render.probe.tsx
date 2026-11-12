/**
 * `pnpm survey:render` 가 vitest(jsdom)로 돌리는 그리기 — 관리자 「설문 보기」와 같은 컴포넌트·같은 입력이다
 * (`SurveyResponseFlow mode="preview"` + previewContext). 테스트가 아니라 출력기라 단언하지 않는다.
 *
 * 입력은 env 로 받는다: SURVEY_OPS_DUMP(dump 파일) · SURVEY_OPS_OUT(결과 파일) · SURVEY_OPS_MOBILE · SURVEY_OPS_NEXT ·
 * SURVEY_OPS_ANSWERS(깔아 둘 응답 JSON — 키는 문항 코드 또는 문항 id) · SURVEY_OPS_CLICK(누를 표 칸 id, 쉼표로 여럿).
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

/** 문항 코드 키를 문항 id 로 바꾼다 — `__` 로 시작하는 사이드카 키(`__optTexts__` 등)와 이미 id 인 키는 그대로. */
function resolveAnswerKeys(
  answers: Record<string, unknown>,
  survey: Survey,
): Record<string, unknown> {
  const idByCode = new Map(
    (survey.questions ?? []).flatMap((q) =>
      q.questionCode ? [[q.questionCode, q.id] as const] : [],
    ),
  );
  const ids = new Set((survey.questions ?? []).map((q) => q.id));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (key.startsWith('__') || ids.has(key)) out[key] = value;
    else if (idByCode.has(key)) out[idByCode.get(key)!] = value;
    else throw new Error(`--answers 의 「${key}」 는 이 설문의 문항 코드도 문항 id 도 아닙니다`);
  }
  return out;
}

function findNextButton(root: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
  return (
    buttons.find((b) => NEXT_LABELS.includes((b.textContent ?? '').trim()) && !b.disabled) ?? null
  );
}

const CELL_CONTROL = 'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]';

/**
 * 컨트롤이 어느 표 칸의 것인가. 격자 표는 칸을 `data-cell-id` 로 감싸고, 모바일 카드의 보기 타일은 감싸는 표식 없이
 * 입력 요소 id 가 `…-<칸 id>` 로 끝난다(choice-opt-cell 의 inputId). 둘 다 아니면 표 칸의 컨트롤이 아니다.
 */
function cellIdOfControl(control: Element, knownCellIds: ReadonlySet<string>): string | null {
  const host = control.closest('[data-cell-id]')?.getAttribute('data-cell-id');
  if (host) return host;
  const id = control.getAttribute('id') ?? '';
  for (const cellId of knownCellIds) if (id.endsWith(`-${cellId}`)) return cellId;
  return null;
}

const isChecked = (el: Element) =>
  (el as HTMLInputElement).checked === true ||
  el.getAttribute('aria-checked') === 'true' ||
  el.getAttribute('data-state') === 'checked';

/** 이 쪽에 그려진 선택 칸의 컨트롤 — 칸 id → 컨트롤들(같은 칸을 여러 호스트가 그릴 수 있다). */
function cellControls(
  root: HTMLElement,
  knownCellIds: ReadonlySet<string>,
): Map<string, HTMLElement[]> {
  const controls = new Map<string, HTMLElement[]>();
  for (const control of Array.from(root.querySelectorAll(CELL_CONTROL))) {
    const cellId = cellIdOfControl(control, knownCellIds);
    if (cellId) controls.set(cellId, [...(controls.get(cellId) ?? []), control as HTMLElement]);
  }
  return controls;
}

/** 칸 id → 골라졌는가. 하나라도 골라졌으면 참. */
function cellStates(root: HTMLElement, knownCellIds: ReadonlySet<string>): Map<string, boolean> {
  return new Map(
    [...cellControls(root, knownCellIds)].map(([id, list]) => [id, list.some(isChecked)]),
  );
}

/** 칸 id → 「행 이름 · 열 이름」. 행 이름은 그 행의 첫 글자 칸, 없으면 행 라벨이다. */
function cellNames(survey: Survey): Map<string, string> {
  const names = new Map<string, string>();
  const plain = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
  for (const q of survey.questions ?? []) {
    for (const row of q.tableRowsData ?? []) {
      const rowName =
        plain(row.cells.find((c) => c.type === 'text' && plain(c.content))?.content) ||
        plain(row.label);
      row.cells.forEach((cell, idx) => {
        const colName = plain(q.tableColumns?.[idx]?.label);
        names.set(cell.id, [q.questionCode, rowName, colName].filter(Boolean).join(' · '));
      });
    }
  }
  return names;
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
  const answersPath = process.env['SURVEY_OPS_ANSWERS'];
  const initialResponses = answersPath
    ? resolveAnswerKeys(
        JSON.parse(readFileSync(answersPath, 'utf8')) as Record<string, unknown>,
        dump.survey,
      )
    : undefined;

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
        ...(initialResponses ? { initialResponses } : {}),
      }}
    />,
  );
  await settle(container);

  const sections: string[] = [];
  const header = [
    `# ${dump.survey.title} — ${dump.source === 'published' ? '배포본' : '저장본'} · ${mobile ? '모바일(<768px)' : '데스크톱'}`,
    `# 명단 값: ${dump.contact ? `${dump.contact.isTest ? '테스트 ' : ''}조사 대상 #${dump.contact.resid}` : '없음'}`,
    `# 깔아 둔 응답: ${initialResponses ? `${Object.keys(initialResponses).length}개 문항` : '없음'}`,
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

  const clickIds = (process.env['SURVEY_OPS_CLICK'] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const names = cellNames(dump.survey);
  const knownCellIds = new Set(names.keys());
  for (const cellId of clickIds) {
    const controls = cellControls(container, knownCellIds).get(cellId);
    if (!controls) {
      sections.push(
        `## 칸 ${cellId} — 이 쪽에 그 칸의 체크박스·라디오가 없어 멈춤 (--next·--answers 로 그 칸이 있는 쪽까지 가야 한다. 선택 칸이 아니어도 이렇게 나온다)`,
      );
      break;
    }
    const control = controls.find((el) => !(el as HTMLInputElement).disabled);
    if (!control) {
      sections.push(`## 칸 ${names.get(cellId) ?? cellId} — 잠긴 칸이라 누를 수 없어 멈춤`);
      break;
    }
    const before = cellStates(container, knownCellIds);
    fireEvent.click(control);
    await settle(container);
    const after = cellStates(container, knownCellIds);
    const mark = (on: boolean | undefined) => (on ? '[✓]' : '[ ]');
    const changed = [...after]
      .filter(([id, on]) => before.get(id) !== on)
      .map(
        ([id, on]) =>
          `${id === cellId ? '누른 칸' : '따라 바뀐 칸'} ${mark(before.get(id))} → ${mark(on)}  ${names.get(id) ?? '(이름 없음)'}  ${id}`,
      );
    sections.push(
      `## 칸 ${names.get(cellId) ?? cellId} 누른 뒤 — 상태가 바뀐 선택 칸 ${changed.length}개\n${changed.length > 0 ? changed.join('\n') : '(바뀐 칸 없음)'}`,
    );
  }

  writeFileSync(outPath, `${sections.join('\n\n')}\n`);
}, 120_000);
