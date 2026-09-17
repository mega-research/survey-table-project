interface Props {
  title: string;
  description?: string;
}

/**
 * 게스트 화면의 빈 상태 (.pen FLOW 5 전반, 역할 모델 v2 티켓 22).
 *
 * 운영 콘솔의 빈 카드를 재사용하지 않는 이유는 그것들이 **다음 행동을 안내**하기 때문이다 —
 * 「조사 대상 업로드로 가세요」 같은 문장은 게스트에게 없는 표면을 가리킨다. 게스트에게
 * 빈 상태는 사실의 진술이지 할 일이 아니다.
 */
export function GuestEmptyState({ title, description }: Props) {
  return (
    <div className="rounded-[14px] border border-dashed border-[#D1D5DB] bg-white py-16 text-center">
      <p className="text-[13.5px] font-semibold text-[#3A3A3C]">{title}</p>
      {description && <p className="mt-1 text-[12.5px] text-[#9CA3AF]">{description}</p>}
    </div>
  );
}
