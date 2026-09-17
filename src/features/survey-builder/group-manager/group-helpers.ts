import { QuestionGroup } from '@/types/survey';

/**
 * 순환 참조 방지: 특정 그룹이 다른 그룹의 상위로 설정 가능한지 확인
 */
export function canBeParentOf(
  potentialParentId: string,
  childId: string,
  groups: QuestionGroup[],
): boolean {
  if (potentialParentId === childId) return false;

  // 잠재적 부모가 현재 그룹의 하위 그룹인지 확인
  const checkDescendant = (targetId: string, ancestorId: string): boolean => {
    const target = groups.find((g) => g.id === targetId);
    if (!target || !target.parentGroupId) return false;
    if (target.parentGroupId === ancestorId) return true;
    return checkDescendant(target.parentGroupId, ancestorId);
  };

  return !checkDescendant(potentialParentId, childId);
}

/**
 * 편집 모달에서 선택 가능한 상위 그룹 목록
 */
export function getAvailableParentGroups(
  currentGroupId: string,
  topLevelGroups: QuestionGroup[],
  allGroups: QuestionGroup[],
): QuestionGroup[] {
  return topLevelGroups.filter(
    (g) => g.id !== currentGroupId && canBeParentOf(g.id, currentGroupId, allGroups),
  );
}
