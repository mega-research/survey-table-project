export const OPTION_TEXT_TARGET_ATTRIBUTE = 'data-option-text-target-id';

export function optionTextTargetId(questionId: string, optionId: string): string {
  return `${questionId}:option:${optionId}`;
}

export function rankingTextTargetId(scopeId: string, rank: number, optionValue: string): string {
  return `${scopeId}:ranking:${rank}:${optionValue}`;
}
