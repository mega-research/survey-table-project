import {
  CheckSquare,
  ChevronDown,
  Circle,
  FileText,
  Info,
  List,
  ListOrdered,
  Table,
  Type,
} from 'lucide-react';

/**
 * 빌더 좌측 팔레트가 나열하는 질문 유형 카탈로그.
 *
 * 설문 생성 화면과 편집 화면이 같은 65줄 배열을 각각 갖고 있었다. 두 사본이 글자 하나
 * 다르지 않았고, 유형을 추가하면 두 화면 모두 고쳐야 했다 — 한쪽만 고치면 화면에 따라
 * 만들 수 있는 질문이 달라진다.
 */
export const questionTypes = [
  {
    type: 'notice' as const,
    label: '공지사항',
    icon: Info,
    description: '설명 및 안내 문구',
    color: 'bg-blue-100 text-blue-600',
  },
  {
    type: 'text' as const,
    label: '단답형',
    icon: Type,
    description: '짧은 텍스트 입력',
    color: 'bg-sky-100 text-sky-600',
  },
  {
    type: 'textarea' as const,
    label: '장문형',
    icon: FileText,
    description: '긴 텍스트 입력',
    color: 'bg-green-100 text-green-600',
  },
  {
    type: 'radio' as const,
    label: '단일선택',
    icon: Circle,
    description: '하나만 선택 가능',
    color: 'bg-purple-100 text-purple-600',
  },
  {
    type: 'checkbox' as const,
    label: '다중선택',
    icon: CheckSquare,
    description: '여러 개 선택 가능',
    color: 'bg-orange-100 text-orange-600',
  },
  {
    type: 'select' as const,
    label: '드롭다운',
    icon: ChevronDown,
    description: '드롭다운 메뉴',
    color: 'bg-pink-100 text-pink-600',
  },
  {
    type: 'multiselect' as const,
    label: '다단계선택',
    icon: List,
    description: '다중 드롭다운',
    color: 'bg-teal-100 text-teal-600',
  },
  {
    type: 'ranking' as const,
    label: '순위형',
    icon: ListOrdered,
    description: '순위 매기기 (1순위, 2순위...)',
    color: 'bg-amber-100 text-amber-600',
  },
  {
    type: 'table' as const,
    label: '테이블',
    icon: Table,
    description: '표 형태 질문',
    color: 'bg-indigo-100 text-indigo-600',
  },
];
