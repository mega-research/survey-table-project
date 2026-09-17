'use client';

import { useState } from 'react';

import { Badge, Card, TextInput } from '@tremor/react';
import { FileText, MessageSquare, Search } from 'lucide-react';

import { formatPercentage } from '@/lib/analytics/analyzer';
import type { TextAnalytics } from '@/lib/analytics/types';
import { formatLocalDateTime } from '@/lib/date-formatters';

interface TextResponsesProps {
  data: TextAnalytics;
}

export function TextResponses({ data }: TextResponsesProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAll, setShowAll] = useState(false);

  const filteredResponses = data.responses.filter((r) =>
    r.value.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const displayResponses = showAll ? filteredResponses : filteredResponses.slice(0, 10);

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{data.questionTitle}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {data.totalResponses}개 응답 · 응답률 {formatPercentage(data.responseRate)}
          </p>
        </div>
        <Badge color="violet">{data.questionType === 'text' ? '단문형' : '장문형'}</Badge>
      </div>

      {/* 통계 요약 */}
      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-500">총 응답</span>
          </div>
          <p className="mt-1 text-xl font-semibold text-gray-900">{data.totalResponses}개</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-500">평균 길이</span>
          </div>
          <p className="mt-1 text-xl font-semibold text-gray-900">{Math.round(data.avgLength)}자</p>
        </div>
      </div>

      {/* 숫자 단답형 통계 (inputType === 'number') */}
      {data.numericStats && (
        <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {[
            { label: '응답 수', value: data.numericStats.count },
            { label: '합계', value: data.numericStats.sum },
            { label: '평균', value: Math.round(data.numericStats.mean * 100) / 100 },
            { label: '최소', value: data.numericStats.min },
            { label: '최대', value: data.numericStats.max },
            { label: '중앙값', value: data.numericStats.median },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-blue-50 p-3">
              <span className="text-xs text-gray-500">{s.label}</span>
              <p className="mt-1 text-lg font-semibold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* 자주 사용된 단어 */}
      {data.wordFrequency && data.wordFrequency.length > 0 && (
        <div className="mb-6">
          <h4 className="mb-2 text-sm font-medium text-gray-700">자주 사용된 단어</h4>
          <div className="flex flex-wrap gap-2">
            {data.wordFrequency.slice(0, 10).map((word) => (
              <span
                key={word.word}
                className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-600"
              >
                {word.word} ({word.count})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 검색 */}
      <div className="mb-4">
        <TextInput
          icon={Search}
          placeholder="응답 검색..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* 응답 목록 */}
      <div className="max-h-96 space-y-3 overflow-y-auto">
        {displayResponses.length > 0 ? (
          displayResponses.map((response) => (
            <div
              key={response.id}
              className="rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50"
            >
              <p className="text-sm whitespace-pre-wrap text-gray-700">{response.value}</p>
              {response.submittedAt && (
                <p className="mt-2 text-xs text-gray-400">
                  {formatLocalDateTime(response.submittedAt)}
                </p>
              )}
            </div>
          ))
        ) : (
          <div className="py-8 text-center text-gray-500">
            <MessageSquare className="mx-auto mb-2 h-8 w-8 text-gray-400" />
            <p>검색 결과가 없습니다.</p>
          </div>
        )}
      </div>

      {/* 더보기 버튼 */}
      {filteredResponses.length > 10 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="mt-4 w-full py-2 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          {showAll ? '접기' : `${filteredResponses.length - 10}개 더 보기`}
        </button>
      )}
    </Card>
  );
}
