/**
 * 쿼터 현황 — 외주는 내 달성 수와 셀 마감 여부만 본다 — 실 로컬 DB (fieldwork-multi-company 티켓 08).
 *
 * 한 설문에 외주 링크 A·B·C, 조사 대상 1–10. A 는 1–5, B 는 6–10 + 5(같이 맡음), C 는 나누지 않는다.
 * 쿼터는 지역 하나(서울 목표 3 · 부산 목표 50). 완료 응답:
 *   서울 — 1·2(A), 5(같이 맡음), 대상 없는 공개 응답 1건 → 설문 전체 4건(목표 3 을 넘어 마감)
 *   부산 — 6(B) → 설문 전체 1건
 * 섞어 둔 것: 진행 중 응답(3), 테스트 파티션 완료 응답 — 둘 다 어느 숫자에도 들지 않는다.
 *
 * `/fw` 페이지 함수를 관문까지 그대로 부르고, 돌아온 RSC 트리에서 화면 조각에 넘기는 props 를
 * 직렬화해 본다 — RSC payload 에 실리는 것이 바로 그 props 다. 외주가 바깥에서 보는 결과만 단언한다.
 *
 * 실 DB 인 이유: 내 달성 수는 응답 × 담당 범위 표의 서브쿼리다. 목이 돌려주는 행은 테스트가 정한
 * 행이라 술어가 무엇이든 통과한다.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<로컬 DB> pnpm exec vitest run <이 파일>. 일반 pnpm test 에서는 스킵된다.
 */
import { createRouterClient } from '@orpc/server';
import { eq, inArray } from 'drizzle-orm';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  contactTargets,
  fieldworkLinkShares,
  surveyResponses,
  surveys,
  teamMembers,
  teams,
  users,
} from '@/db/schema';
import { FIELDWORK_SHARE_ALL } from '@/server/fieldwork-share';
import type { ORPCContext } from '@/server/context';
import type { QuotaConfig } from '@/shared/contracts/quota';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

const requestState = vi.hoisted(() => ({ headers: new Headers() }));

// 관문은 요청 헤더에서 쿠키를 읽는다. 연구원 화면의 「테스트 데이터 보기」 쿠키는 없다(실데이터).
vi.mock('next/headers', () => ({
  headers: async () => requestState.headers,
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const { router } = await import('@/server/router');
const { authenticateAccessLink } = await import('@/server/access-link');
const { getQuotaStatus } = await import('@/server/quota/services/quota-status');
const { default: FieldworkQuotaPage } = await import('@/app/fw/[token]/operations/quota/page');
const { default: FieldworkOverviewPage } = await import('@/app/fw/[token]/operations/overview/page');
const { OperationsOverviewScreen } = await import('@/app/_operations/overview-screen');
const { ClientQuotaScreen } = await import('@/app/_client-console/quota-screen');
const { KpiRow } = await import('@/features/operations/kpi-row');
const { QuotaStatusPanel } = await import('@/features/operations/quota/quota-status-panel');
const { ShareQuotaStatusPanel } = await import('@/features/operations/quota/share-quota-status-panel');

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
const run = process.env['RUN_REALDB'] === '1' && isLocalDb ? describe : describe.skip;

const OWNER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();
const REGION_Q = 'q-region';

const SCHEME: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [{ key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 }],
};

const QUOTA: QuotaConfig = {
  enabled: true,
  dimensions: [
    {
      id: 'd-region',
      questionId: REGION_Q,
      label: '지역',
      kind: 'choice',
      categories: [
        { id: 'c-seoul', label: '서울', values: ['seoul'] },
        { id: 'c-busan', label: '부산', values: ['busan'] },
      ],
    },
  ],
  cells: [
    { categoryIds: ['c-seoul'], target: 3 },
    { categoryIds: ['c-busan'], target: 50 },
  ],
  closedMessage: null,
};

/** 외주에게 실리면 안 되는 키 — 목표·전체 달성 수와, 그것을 되짚게 하는 달성률·톤·요약. */
const TOTAL_KEYS = ['target', 'current', 'pct', 'tone', 'summary', 'targetTotal', 'currentTotal', 'unclassified'];

const owner = createRouterClient(router, {
  context: {
    db,
    user: {
      id: OWNER_ID,
      email: `share-quota-${OWNER_ID}@example.com`,
      name: '연구원',
      status: 'active',
      isSuperadmin: false,
      userType: 'internal',
    },
  } satisfies ORPCContext,
});

interface SignedLink {
  linkId: string;
  token: string;
  cookie: { name: string; value: string };
}

let surveyId = '';
let A: SignedLink;
let B: SignedLink;
let C: SignedLink;
const targetIdByResid = new Map<number, string>();

async function issueAndSignIn(label: string): Promise<SignedLink> {
  const { link, password } = await owner.workspace.accessLinks.issue({ surveyId, kind: 'fieldwork', label });
  const auth = await authenticateAccessLink(link.token, password);
  if (!auth.ok) throw new Error(`접속 실패: ${auth.reason}`);
  return { linkId: link.id, token: link.token, cookie: auth.cookie };
}

function signInAs(link: SignedLink) {
  requestState.headers = new Headers({ cookie: `${link.cookie.name}=${link.cookie.value}` });
}

/** RSC 트리에서 `type` 이 그 컴포넌트인 원소를 전부 모은다(함수 컴포넌트는 펼치지 않는다 — props 가 payload 다). */
function findElements(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  const found: ReactElement<Record<string, unknown>>[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement<Record<string, unknown>>(n)) return;
    if (n.type === type) found.push(n);
    walk(n.props['children'] as ReactNode);
  };
  walk(node);
  return found;
}

/** 직렬화되는 값에 나오는 모든 객체 키 — RSC payload 가 싣는 모양 그대로(함수는 빠진다). */
function keysDeep(value: unknown): Set<string> {
  const keys = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v === null || typeof v !== 'object') return;
    for (const [k, child] of Object.entries(v)) {
      keys.add(k);
      walk(child);
    }
  };
  walk(JSON.parse(JSON.stringify(value)));
  return keys;
}

function expectNoTotals(value: unknown) {
  const keys = keysDeep(value);
  expect(TOTAL_KEYS.filter((k) => keys.has(k))).toEqual([]);
}

/** 셀 라벨 → [내 달성 수, 마감] */
function cellsOf(status: { cells: { labels: string[]; mine: number; closed: boolean }[] }) {
  return Object.fromEntries(status.cells.map((c) => [c.labels.join('·'), [c.mine, c.closed]]));
}

async function fwQuotaPanelProps(link: SignedLink) {
  signInAs(link);
  const tree = await FieldworkQuotaPage({ params: Promise.resolve({ token: link.token }) });
  const panels = findElements(tree, ShareQuotaStatusPanel);
  expect(panels).toHaveLength(1);
  expect(findElements(tree, QuotaStatusPanel)).toHaveLength(0);
  return panels[0]!.props as { status: Parameters<typeof cellsOf>[0] };
}

async function fwOverviewQuota(link: SignedLink) {
  signInAs(link);
  const tree = await FieldworkOverviewPage({
    params: Promise.resolve({ token: link.token }),
    searchParams: Promise.resolve({}),
  });
  // 페이지는 화면 함수 원소 하나를 돌려준다 — 그 props 로 화면을 마저 펼친다(Next 가 하는 일).
  const [screen] = findElements(tree, OperationsOverviewScreen);
  const screenTree = await OperationsOverviewScreen(
    screen!.props as unknown as Parameters<typeof OperationsOverviewScreen>[0],
  );
  const [kpi] = findElements(screenTree, KpiRow);
  const panels = findElements(screenTree, ShareQuotaStatusPanel);
  expect(findElements(screenTree, QuotaStatusPanel)).toHaveLength(0);
  return { kpiQuota: kpi!.props['quota'], panel: panels[0]?.props as { status: Parameters<typeof cellsOf>[0] } };
}

async function seedResponse(answers: Record<string, unknown>, opts: { resid?: number; status?: 'completed' | 'in_progress'; isTest?: boolean }) {
  const status = opts.status ?? 'completed';
  await db.insert(surveyResponses).values({
    surveyId,
    sessionId: `sq-${crypto.randomUUID()}`,
    contactTargetId: opts.resid != null ? targetIdByResid.get(opts.resid)! : null,
    status,
    isCompleted: status === 'completed',
    completedAt: status === 'completed' ? new Date() : null,
    isTest: opts.isTest ?? false,
    questionResponses: answers,
  });
}

run('쿼터 현황 — 외주 링크 투영 (real DB)', () => {
  beforeAll(async () => {
    await db.insert(users).values({
      id: OWNER_ID,
      email: `share-quota-${OWNER_ID}@example.com`,
      name: '연구원',
      status: 'active',
      isSuperadmin: false,
      userType: 'internal',
      emailVerified: true,
    });
    await db.insert(teams).values({ id: TEAM_ID, name: `쿼터팀-${TEAM_ID.slice(0, 8)}` });
    await db.insert(teamMembers).values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'leader' });
    surveyId = crypto.randomUUID();
    await db.insert(surveys).values({
      id: surveyId,
      title: '쿼터 투영 조사',
      teamId: TEAM_ID,
      visibility: 'team',
      assignmentStatus: 'assigned',
      ownerUserId: OWNER_ID,
      createdBy: OWNER_ID,
      contactColumns: SCHEME,
      testContactColumns: SCHEME,
      quotaConfig: QUOTA,
    });
    const inserted = await db
      .insert(contactTargets)
      .values(
        Array.from({ length: 10 }, (_, i) => ({
          surveyId,
          resid: i + 1,
          isTest: false,
          inviteCode: `sq${crypto.randomUUID().slice(0, 12)}`,
          attrs: {},
        })),
      )
      .returning({ id: contactTargets.id, resid: contactTargets.resid });
    for (const r of inserted) targetIdByResid.set(r.resid, r.id);

    A = await issueAndSignIn('프롬');
    B = await issueAndSignIn('프라임');
    C = await issueAndSignIn('세번째');

    const resid = (value: string) => [{ source: 'system.resid' as const, value, op: '' as const }];
    await owner.contacts.fieldworkShares.apply({ surveyId, linkId: A.linkId, clauses: resid('1-5'), overlap: 'take' });
    await owner.contacts.fieldworkShares.apply({ surveyId, linkId: B.linkId, clauses: resid('6-10'), overlap: 'take' });
    // 5번은 같이 맡는다 — 겹침 「같이 맡기기」(티켓 04)가 남기는 상태와 같다.
    await db.insert(fieldworkLinkShares).values({ linkId: B.linkId, contactTargetId: targetIdByResid.get(5)! });

    await seedResponse({ [REGION_Q]: 'seoul' }, { resid: 1 });
    await seedResponse({ [REGION_Q]: 'seoul' }, { resid: 2 });
    await seedResponse({ [REGION_Q]: 'seoul' }, { resid: 5 });
    await seedResponse({ [REGION_Q]: 'seoul' }, {}); // 대상 없는 공개 응답
    await seedResponse({ [REGION_Q]: 'busan' }, { resid: 6 });
    await seedResponse({ [REGION_Q]: 'seoul' }, { resid: 3, status: 'in_progress' });
    await seedResponse({ [REGION_Q]: 'busan' }, { resid: 7, isTest: true });
  });

  afterAll(async () => {
    if (surveyId) {
      await db.delete(fieldworkLinkShares).where(
        inArray(
          fieldworkLinkShares.linkId,
          [A, B, C].filter(Boolean).map((l) => l.linkId),
        ),
      );
      await db.delete(surveyResponses).where(eq(surveyResponses.surveyId, surveyId));
      await db.delete(surveys).where(eq(surveys.id, surveyId));
    }
    await db.delete(teamMembers).where(eq(teamMembers.userId, OWNER_ID));
    await db.delete(teams).where(eq(teams.id, TEAM_ID));
    await db.delete(users).where(eq(users.id, OWNER_ID));
  });

  describe('외주 쿼터 현황 화면', () => {
    it('링크 A 의 투영은 셀마다 내 달성 수와 마감 여부만 담고, 전체 목표·전체 달성 수 키가 없다', async () => {
      const { status } = await fwQuotaPanelProps(A);
      expect(cellsOf(status)).toEqual({ 서울: [3, true], 부산: [0, false] });
      expectNoTotals(status);
    });

    it('전체 기준으로 찬 셀은 내 달성 수와 무관하게 마감으로 보인다', async () => {
      // B 의 서울은 같이 맡은 5번 하나뿐이지만 설문 전체 서울 완료가 목표 3 을 넘었다.
      const { status } = await fwQuotaPanelProps(B);
      expect(cellsOf(status)).toEqual({ 서울: [1, true], 부산: [1, false] });
    });

    it('같이 맡은 대상의 완료는 양쪽 달성 수에 들어가고, 대상 없는 공개 응답은 나눈 링크 어디에도 없다', async () => {
      const a = cellsOf((await fwQuotaPanelProps(A)).status);
      const b = cellsOf((await fwQuotaPanelProps(B)).status);
      // 5번이 양쪽에 — 업체별 합(3 + 1)은 전체 서울 완료(4)와 맞지 않는다. 공개 응답 1건은 어느 쪽에도 없다.
      expect([a['서울']![0], b['서울']![0]]).toEqual([3, 1]);
    });

    it('한 번도 나누지 않은 링크 C 는 지금처럼 설문 전체의 목표·달성 수를 본다 — 안 나누면 지금과 똑같다', async () => {
      signInAs(C);
      const tree = await FieldworkQuotaPage({ params: Promise.resolve({ token: C.token }) });
      expect(findElements(tree, ShareQuotaStatusPanel)).toHaveLength(0);
      const [panel] = findElements(tree, QuotaStatusPanel);
      const status = panel!.props['status'] as { cells: { labels: string[]; current: number; target: number }[] };
      expect(status.cells.map((c) => [c.labels.join('·'), c.current, c.target])).toEqual([
        ['서울', 4, 3],
        ['부산', 1, 50],
      ]);
    });

    it('나누지 않은 링크 C 의 응답 현황 KPI 쿼터 칸도 전체 요약이다', async () => {
      signInAs(C);
      const tree = await FieldworkOverviewPage({
        params: Promise.resolve({ token: C.token }),
        searchParams: Promise.resolve({}),
      });
      const [screen] = findElements(tree, OperationsOverviewScreen);
      const screenTree = await OperationsOverviewScreen(
        screen!.props as unknown as Parameters<typeof OperationsOverviewScreen>[0],
      );
      const [kpi] = findElements(screenTree, KpiRow);
      expect(kpi!.props['quota']).toMatchObject({ kind: 'full', summary: { targetTotal: 53, currentTotal: 5 } });
      expect(findElements(screenTree, QuotaStatusPanel)).toHaveLength(1);
      expect(findElements(screenTree, ShareQuotaStatusPanel)).toHaveLength(0);
    });
  });

  describe('외주 응답 현황 화면의 쿼터 조각', () => {
    it('KPI 카드와 쿼터 패널이 A 몫의 투영을 받고 전체 목표·전체 달성 수 키가 없다', async () => {
      const { kpiQuota, panel } = await fwOverviewQuota(A);
      expect(kpiQuota).toEqual({ kind: 'share', mine: { mineTotal: 3, closedCells: 1, totalCells: 2 } });
      expect(cellsOf(panel.status)).toEqual({ 서울: [3, true], 부산: [0, false] });
      expectNoTotals({ kpiQuota, panel: panel.status });
    });
  });

  describe('내부 콘솔·클라이언트 링크는 그대로다', () => {
    it('현황 서비스는 설문 전체의 목표·달성 수를 지금과 같은 모양으로 돌려준다', async () => {
      const status = await getQuotaStatus(surveyId);
      expect(status!.cells.map((c) => [c.labels.join('·'), c.current, c.target, c.tone])).toEqual([
        ['서울', 4, 3, 'done'],
        ['부산', 1, 50, 'low'],
      ]);
      expect(status!.summary).toEqual({
        targetTotal: 53,
        currentTotal: 5,
        pct: 9,
        closedCells: 1,
        totalCells: 2,
        unclassified: 0,
      });
    });

    it('내부 응답 현황 화면은 전체 요약과 전체 현황판을 그린다', async () => {
      const tree = await OperationsOverviewScreen({
        surveyId,
        capabilities: new Set(['operations.view']),
        scope: 'real',
        share: FIELDWORK_SHARE_ALL,
        searchParams: {},
      });
      const [kpi] = findElements(tree, KpiRow);
      expect(kpi!.props['quota']).toMatchObject({ kind: 'full', summary: { targetTotal: 53, currentTotal: 5 } });
      const [panel] = findElements(tree, QuotaStatusPanel);
      expect((panel!.props['status'] as { cells: unknown[] }).cells).toHaveLength(2);
      expect(findElements(tree, ShareQuotaStatusPanel)).toHaveLength(0);
    });

    it('클라이언트 쿼터 화면은 전체 현황판을 그린다', async () => {
      const tree = await ClientQuotaScreen({ surveyId });
      const [panel] = findElements(tree, QuotaStatusPanel);
      expect((panel!.props['status'] as { summary: unknown }).summary).toMatchObject({ targetTotal: 53 });
    });
  });
});
