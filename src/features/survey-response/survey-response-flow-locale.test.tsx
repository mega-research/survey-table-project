import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import type { Question, QuestionGroup, Survey } from '@/types/survey';

/**
 * 응답 화면의 현재 언어 (CONTEXT.md 「언어 문항」) — 언어 문항의 답에서 파생해 응답 화면을
 * 감싸는 요소의 `lang` 에 싣는다. 고르기 전(미정)에는 `lang` 을 달지 않는다.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// 명단 값이 필요한 시나리오(토큰 프리필)만 실응답 경로로 그린다 — 미리보기는 명단 값이 늘 비어 있다.
const rpc = vi.hoisted(() => ({
  forResponse: vi.fn(),
  attrsLookup: vi.fn(),
  createWithFirstAnswer: vi.fn(),
  saveDraft: vi.fn(),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      publicRead: {
        bySlug: vi.fn().mockResolvedValue({ id: 'lang-survey' }),
        byPrivateToken: vi.fn(),
        forResponse: (...a: unknown[]) => rpc.forResponse(...a),
      },
    },
    contacts: {
      attrs: { lookup: (...a: unknown[]) => rpc.attrsLookup(...a) },
      priorAnswers: { lookup: vi.fn().mockResolvedValue(null) },
    },
    surveyResponse: {
      lifecycle: {
        stepVisit: vi.fn().mockResolvedValue(undefined),
        resume: vi.fn().mockResolvedValue(null),
      },
      response: {
        createWithFirstAnswer: (...a: unknown[]) => rpc.createWithFirstAnswer(...a),
        createBlank: vi.fn(),
        saveDraft: (...a: unknown[]) => rpc.saveDraft(...a),
        complete: vi.fn(),
      },
      duplicate: { checkOnEntry: vi.fn().mockResolvedValue({ blocked: false }) },
    },
    quota: { check: vi.fn() },
  },
}));

function buildSurvey(
  questions: Question[],
  localizedMessages: Survey['settings']['localizedMessages'] = null,
  groups: QuestionGroup[] = [],
): Survey {
  return {
    id: 'lang-survey',
    title: '다국어 설문',
    status: 'published',
    currentVersionId: 'version-1',
    groups,
    questions,
    settings: {
      isPublic: true,
      allowMultipleResponses: true,
      showProgressBar: true,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '감사합니다.',
      requireInviteToken: false,
      localizedMessages,
    },
    lookups: [],
    createdAt: new Date('2026-10-27T00:00:00.000Z'),
    updatedAt: new Date('2026-10-27T00:00:00.000Z'),
  } as Survey;
}

const LANG_QUESTION: Question = {
  id: 'lang',
  type: 'radio',
  title: '언어를 선택해 주세요',
  required: true,
  order: 0,
  options: [
    { id: 'o-ko', label: '한국어', value: '1', locale: 'ko' },
    { id: 'o-zh', label: '中文', value: '2', locale: 'zh' },
    { id: 'o-en', label: 'English', value: '3', locale: 'en' },
  ],
};

/** 언어 문항과 같은 페이지의 필수 문항 + 다음 페이지 문항 — 언어 페이지 자동 넘김(04)이 걸리지 않는다. */
const SYSTEM_TEXT_QUESTIONS: Question[] = [
  LANG_QUESTION,
  { id: 'name', type: 'text', title: '성명', required: true, order: 1 },
  {
    id: 'later',
    type: 'text',
    title: '다음 페이지',
    required: false,
    order: 2,
    pageBreakBefore: true,
  },
];

const DOCUMENT_QUESTION: Question = {
  id: 'doc-q',
  type: 'radio',
  title: '조사표 문항',
  required: false,
  order: 1,
  pageBreakBefore: true,
  options: [{ id: 'd1', label: '필요함', value: '1' }],
};

const DOCUMENT_VIEW = {
  url: 'https://example.test/doc.pdf',
  pageCount: 1,
  anchors: [{ ownerKind: 'question' as const, ownerId: 'doc-q', page: 1, x: 0, y: 0, w: 1, h: 1 }],
};

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function renderFlow(
  questions: Question[],
  localizedMessages: Survey['settings']['localizedMessages'] = null,
  documentView: typeof DOCUMENT_VIEW | null = null,
  groups: QuestionGroup[] = [],
) {
  return render(
    <SurveyResponseFlow
      mode="preview"
      surveyIdentifier="preview-lang-survey"
      previewContext={{
        survey: buildSurvey(questions, localizedMessages, groups),
        versionId: 'version-1',
        documentView,
      }}
    />,
  );
}

/** 언어 묶음 — 표시 조건이 「언어 문항 = 그 언어」 하나뿐인 그룹 (CONTEXT.md 「언어 묶음」). */
function languageSet(id: string, order: number, value: string): QuestionGroup {
  return {
    id,
    surveyId: 'lang-survey',
    name: id,
    order,
    displayCondition: {
      logicType: 'AND',
      conditions: [
        {
          id: `c-${id}`,
          sourceQuestionId: 'lang',
          conditionType: 'value-match',
          requiredValues: [value],
          logicType: 'AND',
        },
      ],
    },
  };
}

/** 페이지 하나에 문항 하나 — 언어 페이지 · 한국어판 두 쪽 · 중국어판 두 쪽. */
function pageQuestion(id: string, groupId: string, order: number): Question {
  return {
    id,
    type: 'text',
    title: id,
    required: false,
    order,
    groupId,
    pageBreakBefore: true,
    placeholder: `${id} 입력`,
  };
}

const LANGUAGE_SETS: QuestionGroup[] = [
  { id: 'g-lang', surveyId: 'lang-survey', name: '언어', order: 0 },
  languageSet('g-ko', 1, '1'),
  languageSet('g-zh', 2, '2'),
];
const MULTILINGUAL_QUESTIONS: Question[] = [
  { ...LANG_QUESTION, groupId: 'g-lang' },
  pageQuestion('ko-1', 'g-ko', 1),
  pageQuestion('ko-2', 'g-ko', 2),
  pageQuestion('zh-1', 'g-zh', 3),
  pageQuestion('zh-2', 'g-zh', 4),
];

function renderMultilingualFlow() {
  return renderFlow(MULTILINGUAL_QUESTIONS, null, null, LANGUAGE_SETS);
}

/** 「다음」 — 어느 언어 글자로 그려지든 찾는다 */
const nextButton = () => screen.queryByRole('button', { name: /다음|下一步|Next/ });
const languageSwitch = () => screen.queryByRole('button', { name: '언어 변경 · 语言 · Language' });

describe('응답 화면의 현재 언어', () => {
  beforeEach(() => {
    mockMatchMedia(false);
    // 필수 안내로 스크롤한다 — jsdom 에는 scrollIntoView 가 없다
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('언어를 고르기 전에는 lang 을 달지 않고, 고르면 그 언어가 된다', async () => {
    const { container } = renderMultilingualFlow();
    await screen.findByText('언어를 선택해 주세요');
    expect(container.querySelector('[lang]')).toBeNull();

    fireEvent.click(screen.getByText('中文'));
    await screen.findByPlaceholderText('zh-1 입력');
    expect(container.querySelector('[lang]')?.getAttribute('lang')).toBe('zh');
  });

  it('다국어 설문이 아니면 한국어다', async () => {
    const { container } = renderFlow([
      { id: 'q1', type: 'text', title: '첫 질문', required: false, order: 0 },
    ]);
    await screen.findByText('첫 질문');
    expect(container.querySelector('[lang]')?.getAttribute('lang')).toBe('ko');
  });

  it('중국어를 고르면 이동 버튼과 필수 안내가 중국어다', async () => {
    renderFlow(SYSTEM_TEXT_QUESTIONS);
    await screen.findByText('언어를 선택해 주세요');
    expect(screen.getByRole('button', { name: /다음/ })).toBeInTheDocument();

    fireEvent.click(screen.getByText('中文'));
    expect(screen.getByRole('button', { name: /上一步/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /다음/ })).toBeNull();

    // 같은 페이지의 필수 문항을 비운 채 넘기면 필수 안내가 중국어로 나온다
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    expect(await screen.findByText('* 请回答必答题')).toBeInTheDocument();
  });

  it('중국어를 고르면 문항의 필수 안내와 이메일 형식 오류가 중국어다', async () => {
    renderFlow([
      LANG_QUESTION,
      { id: 'name', type: 'text', title: '성명', required: true, order: 1 },
      { id: 'mail', type: 'text', title: '이메일', required: false, order: 2, inputType: 'email' },
      { id: 'later', type: 'text', title: '다음 페이지', required: false, order: 3, pageBreakBefore: true },
    ]);
    await screen.findByText('언어를 선택해 주세요');
    fireEvent.click(screen.getByText('中文'));
    // 저작자가 비운 입력칸 안내도 고른 언어다
    expect(screen.getByPlaceholderText('请输入答案...')).toBeInTheDocument();

    const mail = screen.getByPlaceholderText('name@example.com');
    fireEvent.change(mail, { target: { value: 'abc' } });
    fireEvent.blur(mail);
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

    expect(await screen.findByText('请回答此必答题。')).toBeInTheDocument();
    expect(screen.getAllByText(/电子邮箱格式不正确/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/필수 질문에 답변해주세요/)).toBeNull();
    expect(screen.queryByText(/이메일 형식이 아닙니다/)).toBeNull();
  });

  it('모바일 하단 내비와 응답 진행도 고른 언어다', async () => {
    mockMatchMedia(true);
    renderFlow(SYSTEM_TEXT_QUESTIONS);
    await screen.findByText('언어를 선택해 주세요');

    fireEvent.click(screen.getByText('English'));
    expect(screen.getAllByRole('button', { name: /Next/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Previous/ }).length).toBeGreaterThan(0);
    expect(screen.getByText('1/3 answered')).toBeInTheDocument();
  });

  it('언어를 고르기 전의 안내 화면은 세 언어를 위아래로 함께 보인다', async () => {
    // 조사표를 끼는 설문을 좁은 화면에서 열면 언어를 고르기 전에 PC 안내가 설문 전체를 막는다
    mockMatchMedia(true);
    renderFlow([LANG_QUESTION, DOCUMENT_QUESTION], null, DOCUMENT_VIEW);

    expect(await screen.findByText('PC 에서 열어 주세요')).toBeInTheDocument();
    expect(screen.getByText('请在电脑上打开')).toBeInTheDocument();
    expect(screen.getByText('Please open this on a PC')).toBeInTheDocument();
  });

  it('다국어 설문이 아니면 안내 화면은 지금처럼 한국어 하나다', async () => {
    mockMatchMedia(true);
    const { container } = renderFlow([DOCUMENT_QUESTION], null, DOCUMENT_VIEW);

    const heading = await screen.findByRole('heading', { name: 'PC 에서 열어 주세요' });
    expect(heading.textContent).toBe('PC 에서 열어 주세요');
    expect(container.textContent).not.toMatch(/请|Please/);
  });

  it('언어별 제목 — 고르기 전에는 세 언어 제목을 쌓고, 고르면 그 언어 제목이다', async () => {
    const { container } = renderFlow(
      MULTILINGUAL_QUESTIONS,
      {
        zh: { title: '绩效评估调查' },
        en: { title: 'Performance Evaluation Survey' },
      },
      null,
      LANGUAGE_SETS,
    );
    await screen.findByText('언어를 선택해 주세요');
    const headings = () => [...container.querySelectorAll('h1')].map((h) => h.textContent);
    expect(headings()).toContain('다국어 설문\n绩效评估调查\nPerformance Evaluation Survey');

    fireEvent.click(screen.getByText('中文'));
    await screen.findByPlaceholderText('zh-1 입력');
    expect(headings()).toContain('绩效评估调查');
    expect(headings()).not.toContain('다국어 설문');
  });

  describe('언어 페이지 — 고르면 넘어간다', () => {
    it('언어 문항 하나뿐인 페이지에는 「다음」 버튼과 진행률 숫자가 없다', async () => {
      renderMultilingualFlow();
      await screen.findByText('언어를 선택해 주세요');
      expect(nextButton()).toBeNull();
      expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();
    });

    it('보기를 누르면 그 언어판 첫 페이지로 한 번만 넘어간다 — 연타해도 한 번', async () => {
      renderMultilingualFlow();
      await screen.findByText('언어를 선택해 주세요');
      const zh = screen.getByText('中文');

      // 두 번의 누르기가 한 번의 렌더 안에 들어오게 한다 — 실제 연타처럼 화면이 바뀌기 전 두 번째 누르기
      act(() => {
        fireEvent.click(zh);
        fireEvent.click(zh);
      });

      expect(await screen.findByPlaceholderText('zh-1 입력')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('zh-2 입력')).toBeNull();
      expect(screen.queryByText('언어를 선택해 주세요')).toBeNull();
      // 언어판 페이지에는 「다음」이 돌아온다
      expect(nextButton()).not.toBeNull();
    });
  });

  describe('언어 변경', () => {
    it('언어판 페이지 위의 「언어 변경」을 누르면 고른 보기가 선택된 채 언어 페이지로 돌아간다', async () => {
      renderMultilingualFlow();
      await screen.findByText('언어를 선택해 주세요');
      expect(languageSwitch()).toBeNull();

      fireEvent.click(screen.getByText('中文'));
      await screen.findByPlaceholderText('zh-1 입력');
      fireEvent.click(nextButton()!);
      await screen.findByPlaceholderText('zh-2 입력');

      fireEvent.click(languageSwitch()!);
      await screen.findByText('언어를 선택해 주세요');
      expect(screen.getByRole('radio', { name: '中文' })).toBeChecked();
      expect(languageSwitch()).toBeNull();

      // 같은 보기를 다시 누르면 선택이 풀리지 않고 그 언어판 첫 페이지로 넘어간다
      fireEvent.click(screen.getByText('中文'));
      expect(await screen.findByPlaceholderText('zh-1 입력')).toBeInTheDocument();
      expect(screen.getByText('zh-1')).toBeInTheDocument();
    });

    it('다국어 설문이 아니면 「언어 변경」이 없다', async () => {
      renderFlow([
        { id: 'q1', type: 'text', title: '첫 질문', required: false, order: 0 },
        {
          id: 'q2',
          type: 'text',
          title: '둘째 질문',
          required: false,
          order: 1,
          pageBreakBefore: true,
        },
      ]);
      await screen.findByText('첫 질문');
      expect(languageSwitch()).toBeNull();
    });

    it('다른 언어를 고르면 이전 언어판 답은 지워진다 (숨은 문항 규칙)', async () => {
      renderMultilingualFlow();
      await screen.findByText('언어를 선택해 주세요');

      fireEvent.click(screen.getByText('中文'));
      fireEvent.change(await screen.findByPlaceholderText('zh-1 입력'), {
        target: { value: '中文答案' },
      });

      fireEvent.click(languageSwitch()!);
      fireEvent.click(await screen.findByText('한국어'));
      await screen.findByPlaceholderText('ko-1 입력');

      fireEvent.click(languageSwitch()!);
      fireEvent.click(await screen.findByText('中文'));
      expect(await screen.findByPlaceholderText('zh-1 입력')).toHaveValue('');
    });

    it('명단 토큰 프리필 칸은 새 언어판에서 처음 보일 때 다시 깔린다', async () => {
      window.localStorage.clear();
      useSurveyResponseStore.getState().resetResponseState();
      // 문4 부스비용처럼 언어판마다 같은 명단 열을 읽는 「응답자가 고칠 수 있게」 칸
      const boothTable = (id: string, groupId: string, order: number): Question => ({
        id,
        type: 'table',
        title: `${id} 부스비용`,
        required: false,
        order,
        groupId,
        pageBreakBefore: true,
        tableColumns: [
          { id: `${id}-col-label`, label: '항목' },
          { id: `${id}-col-value`, label: '금액' },
        ],
        tableRowsData: [
          {
            id: `${id}-row`,
            label: '부스비용',
            cells: [
              { id: `${id}-label`, type: 'text', content: '부스비용' },
              {
                id: `${id}-cost`,
                type: 'input',
                content: '',
                placeholder: `${id} 금액`,
                defaultValueTemplate: '{{1차_부스비용}}',
                prefillEditable: true,
              },
            ],
          },
        ],
      });
      const survey = buildSurvey(
        [
          { ...LANG_QUESTION, groupId: 'g-lang' },
          boothTable('ko-booth', 'g-ko', 1),
          boothTable('zh-booth', 'g-zh', 2),
        ],
        null,
        LANGUAGE_SETS,
      );
      rpc.forResponse.mockResolvedValue({
        survey,
        versionId: 'version-1',
        control: {
          isPaused: false,
          pausedMessage: null,
          testSession: 'none',
          testSessionKind: null,
        },
      });
      rpc.attrsLookup.mockResolvedValue({ '1차_부스비용': '1200' });
      rpc.createWithFirstAnswer.mockResolvedValue({
        kind: 'created',
        id: 'response-1',
        contactTargetId: null,
      });
      rpc.saveDraft.mockResolvedValue({ ok: true });

      render(
        <SurveyResponseFlow
          surveyIdentifier="lang-survey"
          inviteToken="11111111-1111-4111-8111-111111111111"
          testToken={null}
        />,
      );
      await screen.findByText('언어를 선택해 주세요');
      await waitFor(() => expect(rpc.attrsLookup).toHaveBeenCalled());

      fireEvent.click(screen.getByText('한국어'));
      const koCost = await screen.findByPlaceholderText('ko-booth 금액');
      await waitFor(() => expect(koCost).toHaveValue('1200'));
      const user = userEvent.setup();
      await user.clear(koCost);
      await user.type(koCost, '1300');
      expect(koCost).toHaveValue('1300');

      fireEvent.click(languageSwitch()!);
      fireEvent.click(await screen.findByText('中文'));
      const zhCost = await screen.findByPlaceholderText('zh-booth 금액');
      await waitFor(() => expect(zhCost).toHaveValue('1200'));

      // 돌아가 한국어를 다시 고르면 고쳤던 한국어판 값은 지워졌고 명단 값이 다시 깔린다
      fireEvent.click(languageSwitch()!);
      fireEvent.click(await screen.findByText('한국어'));
      const koAgain = await screen.findByPlaceholderText('ko-booth 금액');
      await waitFor(() => expect(koAgain).toHaveValue('1200'));
    });
  });
});
