'use client';

import { useEffect, useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { listContactsForSampleAction } from '@/actions/contact-attrs-actions';

const NONE_SENTINEL = '__none__';

interface Props {
  /** 선택된 컨택 id. null 이면 익명 (미선택) 상태. */
  value: string | null;
  /** 선택 변경 콜백. 익명 선택 시 contactId=null, attrs={} 로 호출. */
  onChange: (contactId: string | null, attrs: Record<string, string>) => void;
}

/**
 * 빌더 테스트 모드 — 좌변 셀 산술/우변 LUT 룩업 평가를 위해
 * 설문에 업로드된 첫 50건 컨택 중 하나를 attrs 출처로 사용.
 *
 * 응답 페이지 본체와 다른 점:
 *  - 응답 페이지는 inviteToken 으로만 attrs 매칭 (PII 노출 방어)
 *  - 빌더 셀렉터는 어드민 인증 컨텍스트에서만 작동
 */
export function SampleContactSelector({ value, onChange }: Props) {
  const surveyId = useSurveyBuilderStore((s) => s.currentSurvey.id);
  const [list, setList] = useState<
    Array<{ id: string; label: string; attrs: Record<string, string> }>
  >([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!surveyId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const rows = await listContactsForSampleAction(surveyId, 50);
        if (!cancelled) setList(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [surveyId]);

  // 신규 설문 생성 직후 surveyId 가 빈 상태에서는 셀렉터를 노출하지 않음.
  // (server action 호출이 의미 없고, 빈 옵션만 보이는 미세 깜빡임 방지)
  if (!surveyId) return null;

  return (
    <Select
      value={value ?? NONE_SENTINEL}
      onValueChange={(v) => {
        if (v === NONE_SENTINEL) {
          onChange(null, {});
          return;
        }
        const found = list.find((r) => r.id === v);
        onChange(v, found?.attrs ?? {});
      }}
    >
      <SelectTrigger className="w-64">
        <SelectValue
          placeholder={loading ? '컨택 불러오는 중…' : '테스트 컨택 선택'}
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_SENTINEL}>미선택 (익명)</SelectItem>
        {list.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
