'use client';

import { Badge, BarChart, Card, Tab, TabGroup, TabList, TabPanel, TabPanels } from '@tremor/react';
import { BarChart3, Grid3X3, ListOrdered, Table } from 'lucide-react';

import { formatPercentage } from '@/lib/analytics/analyzer';
import type { RankingOptionDistribution, TableAnalytics } from '@/lib/analytics/types';

interface TableAnalyticsChartProps {
  data: TableAnalytics;
}

// 20가지 색상 팔레트 (Tremor BarChart의 colors prop은 bare color 이름을 요구)
const PALETTE = [
  'blue',
  'cyan',
  'indigo',
  'violet',
  'fuchsia',
  'rose',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'sky',
  'slate',
  'zinc',
  'neutral',
  'stone',
  'gray',
];

// 히트맵 미니 바용 배경 클래스 (PALETTE와 동일 순서 1:1 대응).
// 런타임 템플릿 리터럴(`bg-${color}-500`)은 Tailwind v4 content scanner가
// 정적 분석으로 감지하지 못해 CSS 번들에서 누락된다. 완전한 리터럴 문자열로
// 나열해야 스캐너가 인식하므로 별도 배열로 분리한다.
const BAR_BG_CLASSES = [
  'bg-blue-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-fuchsia-500',
  'bg-rose-500',
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-yellow-500',
  'bg-lime-500',
  'bg-green-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-slate-500',
  'bg-zinc-500',
  'bg-neutral-500',
  'bg-stone-500',
  'bg-gray-500',
];

export function TableAnalyticsChart({ data }: TableAnalyticsChartProps) {
  // 스택 막대 그래프를 위한 데이터 변환
  // 각 행(Row)을 기준으로, 각 옵션(Column 값 등)의 분포를 계산해야 함.
  // 현재 data.rowSummary.details에 옵션별 분포가 들어있음.
  // details가 없으면 '응답함'으로 처리.

  // 모든 가능한 카테고리(옵션 이름들) 수집
  const allCategories = new Set<string>();
  data.rowSummary.forEach((row) => {
    if (row.details) {
      Object.keys(row.details).forEach((key) => allCategories.add(key));
    } else {
      allCategories.add('응답함');
    }
  });
  const categoriesList = Array.from(allCategories);

  // 차트 데이터 생성
  const stackChartData = data.rowSummary.map((row) => {
    const item: Record<string, any> = {
      name: row.rowLabel.length > 20 ? row.rowLabel.slice(0, 20) + '...' : row.rowLabel,
      fullName: row.rowLabel,
    };

    // details가 있으면 각 옵션별 수치를, 없으면 총 인터랙션 수를 '응답함'으로 할당
    if (row.details) {
      categoriesList.forEach((cat) => {
        item[cat] = row.details?.[cat] || 0;
      });
    } else {
      item['응답함'] = row.totalInteractions;
    }

    // 응답하지 않음(회색 처리용) 계산 (필요시)
    // 여기서는 응답한 수치만 보여주는 것이 깔끔함.

    return item;
  });

  // 5. 텍스트 응답 수집
  const textResponseData: Array<{
    rowLabel: string;
    colLabel: string;
    responses: string[];
  }> = [];

  // 6. 순위형(ranking) 셀 집계 수집 (Case 3)
  const rankingCellData: Array<{
    rowLabel: string;
    colLabel: string;
    positions: number;
    maxPossibleScore: number;
    distribution: RankingOptionDistribution[];
  }> = [];

  data.cellAnalytics?.forEach((row) => {
    row.cells.forEach((cell: any) => {
      if (cell.textResponses && cell.textResponses.length > 0) {
        textResponseData.push({
          rowLabel: row.rowLabel,
          colLabel: cell.columnLabel,
          responses: cell.textResponses,
        });
      }
      if (cell.cellType === 'ranking' && Array.isArray(cell.rankingDistribution)) {
        rankingCellData.push({
          rowLabel: row.rowLabel,
          colLabel: cell.columnLabel,
          positions: cell.rankingPositions ?? 3,
          maxPossibleScore: cell.rankingMaxPossibleScore ?? 0,
          distribution: cell.rankingDistribution,
        });
      }
    });
  });

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{data.questionTitle}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {data.totalResponses}명 응답 · 응답률 {formatPercentage(data.responseRate)}
          </p>
          {/* [해결 1] 조건부 로직 무시 경고 문구 추가 */}
          <div className="mt-2 inline-block rounded bg-blue-50 px-2 py-1 text-xs text-blue-600">
            ℹ️ 응답률은 해당 문항이 노출된 참여자 기준입니다. (조건부 노출 반영됨)
          </div>
        </div>
        <Badge color="amber" icon={Table}>
          테이블 ({data.rowSummary.length}개 항목)
        </Badge>
      </div>

      <TabGroup>
        <TabList variant="solid" className="w-fit">
          {[
            <Tab key="dist" icon={BarChart3}>
              항목별 분포
            </Tab>,
            <Tab key="heat" icon={Grid3X3}>
              상세 보기 (히트맵)
            </Tab>,
            ...(textResponseData.length > 0
              ? [
                  <Tab key="text" icon={Table}>
                    주관식 답변 (
                    {textResponseData.reduce((acc, curr) => acc + curr.responses.length, 0)})
                  </Tab>,
                ]
              : []),
            ...(rankingCellData.length > 0
              ? [
                  <Tab key="ranking" icon={ListOrdered}>
                    순위형 셀 ({rankingCellData.length})
                  </Tab>,
                ]
              : []),
          ]}
        </TabList>
        <TabPanels>
          {/* 스택 막대 차트 */}
          <TabPanel>
            <BarChart
              className="mt-6 h-96"
              data={stackChartData}
              index="name"
              categories={categoriesList}
              colors={PALETTE}
              valueFormatter={(value) => `${value}명`}
              layout="vertical"
              stack={true}
              showAnimation
              showLegend={true}
              yAxisWidth={100}
            />

            {data.rowSummary.length > 15 && (
              <p className="mt-2 text-center text-xs text-gray-500">
                전체 {data.rowSummary.length}개 항목 중 일부만 표시될 수 있습니다.
              </p>
            )}
          </TabPanel>

          {/* 상세 테이블 (히트맵 스타일) */}
          <TabPanel>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="w-1/4 px-4 py-3 text-left font-medium text-gray-700">
                      항목 (행)
                    </th>
                    <th className="w-24 px-4 py-3 text-right font-medium text-gray-700">응답 수</th>
                    <th className="w-24 px-4 py-3 text-right font-medium text-gray-700">선택률</th>
                    <th className="px-4 py-3 font-medium text-gray-700">상세 분포</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rowSummary.map((row) => {
                    // 히트맵 배경색 농도 계산 (최대 100% 기준)
                    const intensity = Math.min(row.interactionRate, 100) / 100;
                    // Amber 색상 기반 (R=245, G=158, B=11)
                    // 투명도를 조절하여 히트맵 효과
                    const bgColor = `rgba(245, 158, 11, ${intensity * 0.3})`;

                    return (
                      <tr
                        key={row.rowId}
                        className="border-b border-gray-100 transition-colors hover:bg-gray-50"
                        style={{ backgroundColor: bgColor }}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">{row.rowLabel}</td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          {row.totalInteractions}명
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900">
                          {formatPercentage(row.interactionRate)}
                        </td>
                        <td className="px-4 py-3">
                          {/* 미니 바 차트 */}
                          <div className="flex h-4 w-full items-center gap-2 overflow-hidden rounded-full border border-black/5 bg-white/50">
                            {row.details ? (
                              Object.entries(row.details).map(([key, value], i) => {
                                const width = (value / data.totalResponses) * 100;
                                return (
                                  <div
                                    key={key}
                                    className={`h-full first:rounded-l-full last:rounded-r-full ${
                                      BAR_BG_CLASSES[i % BAR_BG_CLASSES.length]
                                    }`}
                                    style={{
                                      width: `${width}%`,
                                    }}
                                    title={`${key}: ${value}명`}
                                  />
                                );
                              })
                            ) : (
                              <div
                                className="h-full rounded-full bg-amber-500"
                                style={{ width: `${Math.min(row.interactionRate, 100)}%` }}
                              />
                            )}
                          </div>
                          {/* 텍스트 상세 */}
                          {row.details && (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                              {Object.entries(row.details).map(([key, value]) => (
                                <span key={key}>
                                  {key}: <b>{value}</b>
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 범례 및 추가 정보 */}
            <div className="mt-4 text-right text-xs text-gray-400">
              * 배경색이 진할수록 선택률이 높은 항목입니다.
            </div>
          </TabPanel>

          {/* 3. 주관식 답변 리스트 뷰 */}
          {...textResponseData.length > 0
            ? [
                <TabPanel key="text-panel">
                  <div className="mt-6 space-y-6">
                    {textResponseData.map((item, idx) => (
                      <div key={idx} className="rounded-lg border bg-gray-50 p-4">
                        <h4 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                          <Badge size="xs" color="gray">
                            {item.rowLabel}
                          </Badge>
                          <span className="text-gray-400">/</span>
                          <span className="text-gray-700">{item.colLabel}</span>
                        </h4>
                        <ul className="max-h-60 space-y-2 overflow-y-auto rounded border border-gray-200 bg-white p-3">
                          {item.responses.map((res, rIdx) => (
                            <li
                              key={rIdx}
                              className="border-b pt-2 pb-2 text-sm text-gray-700 first:pt-0 last:border-0 last:pb-0"
                            >
                              {res}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </TabPanel>,
              ]
            : []}

          {/* 4. 순위형(ranking) 셀 집계 */}
          {...rankingCellData.length > 0
            ? [
                <TabPanel key="ranking-panel">
                  <div className="mt-6 space-y-6">
                    {rankingCellData.map((item, idx) => (
                      <div key={idx} className="rounded-lg border bg-gray-50 p-4">
                        <h4 className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
                          <Badge size="xs" color="gray">
                            {item.rowLabel}
                          </Badge>
                          <span className="text-gray-400">/</span>
                          <span className="text-gray-700">{item.colLabel}</span>
                          <span className="ml-2 text-xs text-gray-500">
                            1~{item.positions}순위 · 최대 총점 {item.maxPossibleScore}
                          </span>
                        </h4>
                        {item.distribution.length === 0 ? (
                          <p className="text-sm text-gray-500">아직 응답이 없습니다.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-sm">
                              <thead>
                                <tr className="border-b border-gray-200 bg-white">
                                  <th className="px-3 py-2 text-left font-medium text-gray-700">
                                    옵션
                                  </th>
                                  <th className="px-3 py-2 text-right font-medium text-gray-700">
                                    총점
                                  </th>
                                  <th className="px-3 py-2 text-right font-medium text-gray-700">
                                    평균 순위
                                  </th>
                                  {Array.from({ length: item.positions }, (_, k) => (
                                    <th
                                      key={k}
                                      className="px-3 py-2 text-right font-medium text-gray-700"
                                    >
                                      {k + 1}순위
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {item.distribution.map((d) => (
                                  <tr
                                    key={d.value}
                                    className="border-b border-gray-100 hover:bg-white"
                                  >
                                    <td className="px-3 py-2 font-medium text-gray-900">
                                      {d.label}
                                    </td>
                                    <td className="px-3 py-2 text-right font-bold text-gray-900">
                                      {d.totalScore}
                                    </td>
                                    <td className="px-3 py-2 text-right text-gray-600">
                                      {d.avgRank !== undefined ? d.avgRank.toFixed(2) : '-'}
                                    </td>
                                    {Array.from({ length: item.positions }, (_, k) => (
                                      <td key={k} className="px-3 py-2 text-right text-gray-600">
                                        {d.rankCounts?.[k] ?? 0}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </TabPanel>,
              ]
            : []}
        </TabPanels>
      </TabGroup>
    </Card>
  );
}
