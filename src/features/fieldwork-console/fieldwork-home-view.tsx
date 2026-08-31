'use client';

import { useState } from 'react';

import { AccountMenu } from '@/components/auth/account-menu';
import { formatLocalDateTime } from '@/lib/date-formatters';
import { cn } from '@/lib/utils';
import { FIELDWORK_ROLE_LABEL, type AuthUser, type FieldworkRole } from '@/shared/contracts/auth';
import type { FieldworkHomeSurveyItem } from '@/shared/contracts/workspace-io';

interface Props {
  user: AuthUser;
  /** 소속 업체명 — 실사에게는 팀이 없어 이 값이 「어디 사람인가」다. */
  organization: string | null;
  role: FieldworkRole;
  /** 내가 초대된 설문. 실사원에게는 이것이 전부다. */
  invited: readonly FieldworkHomeSurveyItem[];
  /**
   * 업체 전체 — **실사 팀장에게만** 채워져 온다. 실사원에게는 null 이고 세그먼트가 아예
   * 그려지지 않는다(.pen 10-1: 「실사원은 세그먼트가 없다」).
   *
   * 빈 배열과 null 을 가르는 이유는 게스트 탭 축과 같다 — 「업체에 아무것도 없다」와
   * 「업체 시야가 없는 사람이다」는 다른 화면이다.
   */
  orgSurveys: readonly FieldworkHomeSurveyItem[] | null;
}

/**
 * 실사 홈 (.pen FLOW 10-1, 역할 모델 v2 티켓 25).
 *
 * 목록은 **서버가 이미 좁혀서** 온다 — 이 화면은 판정을 하지 않는다. 세그먼트도 마찬가지라,
 * `orgSurveys` 가 null 이면 그리지 않을 뿐 「팀장인가」를 여기서 묻지 않는다.
 *
 * 줄의 구분과 액션은 `reason` 이 정한다(세그먼트가 아니라). 「업체 전체」에는 두 종류가
 * 섞여 있어서다 — 내가 초대된 줄은 「조사 대상」으로, 소속원 줄은 「열람」으로 간다.
 *
 * 조사 대상·열람 화면 자체는 티켓 26 이다. 지금은 링크를 걸지 않고 **버튼을 그리지 않는다** —
 * 눌러서 404 가 되는 자리를 미리 만들지 않는 것이 공유 모달의 placeholder 규칙과 같다.
 */
export function FieldworkHomeView({ user, organization, role, invited, orgSurveys }: Props) {
  const [scope, setScope] = useState<'invited' | 'org'>('invited');
  const rows = scope === 'org' && orgSurveys ? orgSurveys : invited;

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="flex h-[56px] items-center justify-between border-b border-[#E5E5EA] bg-white px-6">
        <span className="text-[14px] font-semibold text-[#1C1C1E]">메가허브 실사</span>
        <AccountMenu
          name={user.name}
          affiliation={organization}
          badge={FIELDWORK_ROLE_LABEL[role]}
          // AuthUser.image 는 optional(표시 전용) — AccountMenu 는 값 유무만 보므로 접는다.
          image={user.image ?? null}
        />
      </header>

      <main className="mx-auto max-w-[1000px] px-4 py-10">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-[22px] font-semibold text-[#1C1C1E]">실사 설문</h1>
            <p className="text-[13px] text-[#6E6E73]">
              초대된 설문에서 조사 대상을 확인하고 대리 응답을 진행합니다.
            </p>
          </div>

          {/* 세그먼트는 팀장에게만 — 실사원에게는 「내 초대」 하나뿐이라 고를 것이 없다. */}
          {orgSurveys && (
            <div role="radiogroup" aria-label="범위" className="flex gap-1 rounded-[10px] bg-[#EEF0F4] p-[3px]">
              {(
                [
                  ['invited', '내 초대 설문', invited.length],
                  ['org', '업체 전체', orgSurveys.length],
                ] as const
              ).map(([value, label, count]) => {
                const active = scope === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setScope(value)}
                    className={cn(
                      'h-[30px] rounded-lg px-3 text-[12.5px] transition-colors',
                      active
                        ? 'bg-white font-semibold text-[#2743AE] shadow-sm'
                        : 'text-[#6E6E73] hover:text-[#3A3A3C]',
                    )}
                  >
                    {label} {count}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="mt-6 rounded-[14px] border border-dashed border-[#D1D5DB] bg-white py-16 text-center">
            <p className="text-[13.5px] font-semibold text-[#3A3A3C]">
              {scope === 'org' ? '업체에 배정된 설문이 없습니다.' : '초대된 설문이 없습니다.'}
            </p>
            <p className="mt-1 text-[12.5px] text-[#9CA3AF]">
              담당 연구원이 설문에 초대하면 여기에 표시됩니다.
            </p>
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-[11px] border border-[#E5E5EA] bg-white">
            <table className="w-full">
              <thead className="bg-[#F9FAFB]">
                <tr className="text-left text-[11.5px] font-medium text-[#9CA3AF]">
                  <th className="px-5 py-3 font-medium">설문</th>
                  <th className="px-3 py-3 font-medium">구분</th>
                  <th className="px-3 py-3 font-medium">진척 (완료/목표)</th>
                  <th className="px-3 py-3 font-medium">최근 활동</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.surveyId} className="border-t border-[#E5E5EA]">
                    <td className="px-5 py-3">
                      <span className="flex flex-col">
                        <span className="text-[13.5px] font-semibold text-[#1C1C1E]">
                          {row.title}
                        </span>
                        <span className="text-[11.5px] text-[#9CA3AF]">{subtitle(row)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <ReasonPill reason={row.reason} />
                    </td>
                    <td className="px-3 py-3 text-[12.5px] text-[#3A3A3C]">
                      {row.completedCount} / {row.targetCount ?? '—'}
                    </td>
                    <td className="px-3 py-3 text-[12.5px] text-[#6E6E73]">
                      {row.lastActivityAt ? formatLocalDateTime(row.lastActivityAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 팀장 안내 (.pen 10-1) — 파생 시야가 무엇을 못 하는지 화면이 먼저 말한다.
            강제는 서버 관문이지만, 눌러 보고 거부당하는 것보다 미리 읽는 편이 낫다. */}
        {orgSurveys && (
          <p className="mt-4 rounded-[10px] bg-[#F5F5F7] px-4 py-3 text-[11.5px] leading-[1.5] text-[#6E6E73]">
            「업체 전체」는 실사 팀장 전용 시야입니다. 열람만 가능하며, 결과코드 기록·응답
            대행은 본인이 초대된 설문에서만 할 수 있습니다.
          </p>
        )}
      </main>
    </div>
  );
}

/**
 * 줄 부제 (.pen 10-1) — 내 초대는 「팀 · 소유 연구원」, 업체 시야는 「팀 · 초대 소속원」.
 *
 * 업체 시야에서 소유자가 아니라 **초대받은 동료**를 적는 이유는 그 줄이 답해야 하는 질문이
 * 「누가 뛰고 있는가」라서다. 소유 연구원은 내 초대 줄에서 「누구에게 물어야 하는가」다.
 */
function subtitle(row: FieldworkHomeSurveyItem): string {
  const who =
    row.reason === 'org' && row.invitedColleagueName
      ? `초대 ${row.invitedColleagueName}`
      : row.ownerName
        ? `소유 ${row.ownerName}`
        : null;
  return [row.teamName, who].filter(Boolean).join(' · ') || '—';
}

function ReasonPill({ reason }: { reason: FieldworkHomeSurveyItem['reason'] }) {
  const invited = reason === 'invited';
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-[3px] text-[11px] font-semibold',
        invited ? 'bg-[#E0F2FE] text-[#075985]' : 'bg-[#F3F4F6] text-[#6E6E73]',
      )}
    >
      {invited ? '초대됨' : '업체 시야'}
    </span>
  );
}
