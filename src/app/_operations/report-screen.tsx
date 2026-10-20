import { ProgressEmptyCard } from '@/features/operations/report/progress-empty-card';
import { ProgressFilterBar } from '@/features/operations/report/progress-filter-bar';
import {
  type GroupByOption,
  ProgressGroupByTabs,
} from '@/features/operations/report/progress-group-by-tabs';
import { ProgressTable } from '@/features/operations/report/progress-table';
import { resolveGroupCriteria } from '@/lib/contacts/group-levels';
import { RESID_DEFAULT_LABEL } from '@/lib/operations/contacts-format';
import { listAssignmentOptions } from '@/server/read-models/contact-assignment-options';
import { type ColumnCandidateWithPii, FILTER_SOURCE } from '@/lib/operations/filter-shared';
import type { OperationsDataScope } from '@/server/data-scope';
import { parseConditionFromUrl } from '@/server/operations/services/progress-filters';
import {
  EMPTY_PROGRESS_TOTALS,
  formatProgressGroupKey,
  parseProgressSort,
  resolveActiveGroupKeys,
  type ProgressGroupKey,
  type SortDir,
} from '@/lib/operations/report-progress-format';
import {
  countContactTargets,
  getProgressColumnScheme,
  getProgressGroupLabel,
  getProgressRows,
  getProgressTotals,
} from '@/server/operations/services/report-progress';
import { getContactColumnScheme } from '@/server/read-models/contacts';
import type { SurveyCapability } from '@/shared/contracts/workspace';

/** 분류 기준 칩 하나 — key 는 주소·정렬에 실리는 직렬화된 태그 키. */
interface GroupCriterion extends GroupByOption {
  groupKey: ProgressGroupKey;
  /** 값 없는 그룹 표기 (기본 「(미분류)」) */
  nullLabel?: string;
}

const CONTACT_OWNER_GROUP_KEY: ProgressGroupKey = { kind: 'system', key: 'contact_owner' };

/**
 * 그룹별 진척률 화면의 본문 — 내부 콘솔(`app/(internal)`)과 외주 실사 링크 트리가 함께 쓰는 **한 벌**
 * (ADR-0026, 티켓 06·07).
 *
 * 형제 `overview-screen` 의 주석에 이 폴더의 규칙이 있다. 트리마다 갈리는 것은 셋이다.
 *  - `basePath` — 빈 상태 카드와 필터바가 자기 트리 안의 주소를 만든다.
 *  - `capabilities` — 명단이 비었을 때의 안내가 갈린다. 「업로드하세요」는 `contacts.manage`
 *    를 가진 사람에게만 할 수 있는 말이고, 그 링크가 여는 화면도 admin 트리에만 있다.
 *  - `includeContactOwner` — 「컨택원」 분류 칩. 컨택원은 내부 실사 운영 정보라 내부 콘솔만 켠다.
 */
export interface ReportProgressSearchParams {
  col?: string;
  q?: string;
  page?: string;
  size?: string;
  sort?: string;
  dir?: string;
  groupBy?: string;
}

interface Props {
  surveyId: string;
  /** 이 콘솔의 주소 접두 — 필터·정렬·페이지 이동이 자기 트리 안에 머문다. */
  basePath: string;
  capabilities: ReadonlySet<SurveyCapability>;
  scope: OperationsDataScope;
  /** 「컨택원」 분류 칩을 낼 수 있는가 — 내부 콘솔만 참. 외주 실사 링크에는 컨택원을 보이지 않는다. */
  includeContactOwner: boolean;
  searchParams: ReportProgressSearchParams;
}

export async function ReportProgressScreen({
  surveyId,
  basePath,
  capabilities,
  scope,
  includeContactOwner,
  searchParams: sp,
}: Props) {
  // page 파싱 NaN 가드 — `?page=abc` / 음수 / undefined 모두 1 로 fallback.
  // 가드 없으면 SQL OFFSET NaN ERROR 발생.
  const pageRaw = Number(sp.page);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const size = 20;
  const dir: SortDir = sp.dir === 'asc' ? 'asc' : 'desc';

  // contactScheme 은 pii blindIndex 계산용 piiType 매핑에 필요. getContactColumnScheme 가
  // cache() 로 RSC pass dedupe 되어 있어 getProgressGroupLabel 내부 lookup 과 같은 query 를 공유한다.
  const [scheme, groupLabel, contactScheme] = await Promise.all([
    getProgressColumnScheme(surveyId),
    getProgressGroupLabel(surveyId, scope),
    getContactColumnScheme(surveyId, scope),
  ]);
  // 컨택원은 내부 실사 운영 정보 — 외부 주체에게는 분류 기준 칩이 없다.
  const hasAssignments =
    includeContactOwner && (await listAssignmentOptions(surveyId, scope)).length > 0;
  const visibleColumns = scheme.columns.filter((c) => !c.hidden).sort((a, b) => a.order - b.order);
  // metaKeys 에서 빈 문자열 방어 — `attrs->>''` 는 SQL legal 이지만 의미 없음.
  const metaKeys = visibleColumns.map((c) => c.key).filter((k) => k.length > 0);

  // 후보: system.resid + attrs.* + pii.* 만. 그 외 system.* 은 이번 슬라이스 제외.
  const columnCandidates: ColumnCandidateWithPii[] = (contactScheme?.columns ?? [])
    .filter(
      (c) =>
        c.source === FILTER_SOURCE.RESID ||
        c.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX) ||
        c.source.startsWith(FILTER_SOURCE.PII_PREFIX),
    )
    .map((c) => ({
      source: c.source,
      label: c.label,
      ...(c.piiType !== undefined ? { piiType: c.piiType } : {}),
    }));

  const rawCol = typeof sp.col === 'string' ? sp.col : null;
  const rawQ = typeof sp.q === 'string' ? sp.q : null;
  const condition = parseConditionFromUrl(rawCol, rawQ, columnCandidates);

  // 분류 기준 후보 — 컬럼 설정의 레벨 슬롯 배정을 레벨 순서(대>중>소>세부)로.
  // 라벨은 컬럼 설정에서 편집한 헤더 라벨(엑셀 헤더 시드)을 그대로 사용.
  // 「컨택원」 칩은 컨택원이 하나라도 있을 때 맨 끝에 나오고 처음에는 꺼져 있다 — 보던 진척
  // 보고가 컨택원이 생겼다고 갑자기 바뀌지 않게 (defaultOff).
  const groupByCriteria: GroupCriterion[] = [
    ...resolveGroupCriteria(contactScheme).map((c) => {
      const groupKey: ProgressGroupKey = { kind: 'attrs', key: c.key };
      return { key: formatProgressGroupKey(groupKey), label: c.label, groupKey };
    }),
    ...(hasAssignments
      ? [
          {
            key: formatProgressGroupKey(CONTACT_OWNER_GROUP_KEY),
            label: '컨택원',
            groupKey: CONTACT_OWNER_GROUP_KEY,
            nullLabel: '(배정 없음)',
            defaultOff: true,
          },
        ]
      : []),
  ];
  // URL groupBy 해석:
  // - 미지정 → 컬럼 설정에서 지정한 분류 기준 전체를 설정 순서(대>중>소>세부)대로 자동
  //   선택. 미리 설정해두면 URL 진입만으로 조합 집계가 나오는 모델 (2026-08-14 결정).
  // - 콤마 목록 → 지정된 분류 기준 키만 채택(칩 좁혀보기), 기준 순서로 정규화 + 중복
  //   제거. 유효 키가 하나도 없으면 전체 기준 폴백. 모르는 시스템 키(`system:…`)는
  //   태그 키 파싱에서 버려진다.
  // - 분류 기준 미지정 설문은 기존처럼 업로드 그룹(group_value) 기준 (칩 없음).
  const activeCriteria: GroupCriterion[] = resolveActiveGroupKeys(
    groupByCriteria,
    typeof sp.groupBy === 'string' ? sp.groupBy : undefined,
  );
  const activeKeys = activeCriteria.map((c) => c.key);
  const activeGroupKeys = activeCriteria.map((c) => c.groupKey);
  const titleLabel =
    activeCriteria.length > 0 ? activeCriteria.map((c) => c.label).join('·') : groupLabel;
  const parsedSort = parseProgressSort(sp.sort, metaKeys, activeKeys);
  // 시스템ID 컬럼 비표시 시 firstResid 정렬은 보이지 않는 컬럼 정렬이 되므로 기본값 폴백.
  const showResid = scheme.showResid ?? true;
  const sort = !showResid && parsedSort === 'firstResid' ? 'responseRate' : parsedSort;

  // ProgressTable 의 # 컬럼 헤더 — contactColumns 의 system.resid 라벨 사용.
  // 스킴에 없거나 라벨이 비어있으면 기본 라벨 폴백.
  const residLabel =
    contactScheme?.columns.find((c) => c.source === FILTER_SOURCE.RESID)?.label?.trim() ||
    RESID_DEFAULT_LABEL;

  // 조사 대상 0건 빠른 검출 — getProgressTotals 보다 훨씬 가벼움.
  const isEmpty = (await countContactTargets(surveyId, scope)) === 0;

  const { rows, totals } = isEmpty
    ? { rows: [], totals: EMPTY_PROGRESS_TOTALS }
    : await Promise.all([
        getProgressRows({
          surveyId,
          scope,
          condition,
          page,
          size,
          sort,
          dir,
          metaKeys,
          groupByKeys: activeGroupKeys,
        }),
        getProgressTotals(surveyId, scope, condition, activeGroupKeys),
      ]).then(([r, t]) => ({ rows: r, totals: t }));

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">{titleLabel}별 진척률</h2>
        {activeCriteria.length === 0 && (
          <p className="text-sm text-slate-500">모집단 명단의 그룹 컬럼 기준 자동 집계</p>
        )}
      </div>

      {isEmpty ? (
        <ProgressEmptyCard basePath={basePath} canUpload={capabilities.has('contacts.manage')} />
      ) : (
        <>
          {groupByCriteria.length > 0 && (
            <ProgressGroupByTabs
              options={groupByCriteria.map(({ key, label, defaultOff }) => ({
                key,
                label,
                ...(defaultOff ? { defaultOff } : {}),
              }))}
              activeKeys={activeKeys}
            />
          )}
          <ProgressFilterBar
            basePath={basePath}
            initialSource={condition?.source ?? null}
            // idlist·parity 모드는 FilterCondition 에 value 없음 — rawQ 로 원본 입력값 복원
            initialValue={
              condition && condition.mode !== 'idlist' && condition.mode !== 'parity'
                ? condition.value
                : (rawQ ?? '')
            }
            columnCandidates={columnCandidates}
          />
          <ProgressTable
            rows={rows}
            totals={totals}
            metaColumns={visibleColumns}
            residLabel={residLabel}
            showResid={showResid}
            groupColumns={activeCriteria.map((c) => ({
              key: c.key,
              label: c.label,
              ...(c.nullLabel ? { nullLabel: c.nullLabel } : {}),
            }))}
            page={page}
            size={size}
            sort={sort}
            dir={dir}
          />
        </>
      )}
    </main>
  );
}
