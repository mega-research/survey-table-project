'use client';

import { Card } from '@/components/ui/card';
import { questionTypes } from '@/features/survey-builder/question-types';
import type { Question } from '@/types/survey';

/**
 * 빌더 좌측 질문 유형 팔레트.
 *
 * 설문 생성 화면과 편집 화면이 같은 카드 마크업을 각각 갖고 있었다. 두 사본의 유일한
 * 차이는 onClick 을 블록으로 감쌌는지 여부뿐이라 동작이 같았다.
 *
 * 팔레트 바깥(설문 정보 요약·완료 메시지 모달 등)은 두 화면의 내용이 실제로 달라
 * 여기 포함하지 않는다 — 호출자가 형제로 배치한다.
 */
export function QuestionTypePalette({
  onSelect,
}: {
  onSelect: (type: Question['type']) => void;
}) {
  return (
    <>
      {questionTypes.map((questionType) => {
        const IconComponent = questionType.icon;
        return (
          <Card
            key={questionType.type}
            className="hover-lift cursor-pointer border-gray-200 p-4 transition-all duration-200 hover:border-blue-200"
            onClick={() => {
              onSelect(questionType.type);
            }}
          >
            <div className="flex items-start space-x-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${questionType.color}`}
              >
                <IconComponent className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-medium text-gray-900">{questionType.label}</h4>
                <p className="mt-1 text-xs text-gray-500">{questionType.description}</p>
              </div>
            </div>
          </Card>
        );
      })}
    </>
  );
}
