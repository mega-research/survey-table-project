import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// 뼈대(Base UI Button · render · nativeButton · data-slot)는 shadcn 공식 판 그대로이고,
// **모양은 이 레포 것이다** — 공식 판의 크기·여백·둥글기·색을 쓰지 않는다(src/components/AGENTS.md).
//
// 쓰는 쪽 400여 곳이 이 사양에 맞춰 쓰여 있다: 아이콘 간격은 아이콘의 `mr-2` 가 내고(그래서
// 여기 `gap` 을 두지 않는다 — 두면 간격이 두 번 든다), 아이콘 크기는 `h-3.5 w-3.5` 처럼 직접 적는다.
// 공식 판의 `[&_svg:not([class*='size-'])]:size-4` 는 그 `h-*`·`w-*` 를 이겨 전부 16px 로 만들었다 —
// 그래서 크기를 아무것도 적지 않은 아이콘에만 기본 크기를 준다. 선택자는 클래스 **낱말의 머리**를 본다
// (`^='h-'` 첫 낱말 · `*='_h-'` 는 Tailwind 가 밑줄을 빈칸으로 바꿔 「 h-」) — `*='w-'` 로 쓰면 `shadow-sm` 도 걸린다.
const buttonStyles = cva(
  "group/button inline-flex items-center justify-center rounded-lg text-base font-medium whitespace-nowrap transition-all duration-200 select-none focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-']):not([class^='h-']):not([class*='_h-']):not([class^='w-']):not([class*='_w-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-blue-500 text-white shadow-sm hover:bg-blue-600 hover:shadow-md",
        destructive: "bg-red-500 text-white shadow-sm hover:bg-red-600",
        outline:
          "border border-gray-200 bg-white text-gray-900 shadow-sm hover:border-gray-300 hover:bg-gray-50 aria-expanded:border-gray-300 aria-expanded:bg-gray-50",
        secondary: "bg-gray-100 text-gray-900 shadow-sm hover:bg-gray-200",
        ghost: "text-gray-700 hover:bg-gray-100 aria-expanded:bg-gray-100",
        link: "text-blue-500 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-12 px-6 py-3",
        // xs·icon-xs·icon-sm·icon-lg 는 공식 판에만 있는 크기다(입력 묶음·콤보박스·대화상자 닫기 버튼이 쓴다).
        xs: "h-6 rounded-md px-2 text-xs [&_svg:not([class*='size-']):not([class^='h-']):not([class*='_h-']):not([class^='w-']):not([class*='_w-'])]:size-3",
        sm: "h-9 px-3 py-2 text-sm",
        lg: "h-14 px-8 py-4 text-lg",
        icon: "h-10 w-10",
        "icon-xs":
          "size-6 rounded-md [&_svg:not([class*='size-']):not([class^='h-']):not([class*='_h-']):not([class^='w-']):not([class*='_w-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * 버튼 모양의 클래스 묶음. `<Link className={buttonVariants({ className: 'h-10' })}>` 처럼 버튼이 아닌
 * 요소에 입힐 때도 쓰는 쪽 `className` 이 기본 높이·여백을 이기도록 **병합까지 해서** 돌려준다 —
 * cva 는 이어 붙이기만 해서, 그대로 내보내면 `h-12 h-10` 이 함께 남고 어느 쪽이 이길지는 CSS 순서가 정한다.
 */
function buttonVariants(props?: Parameters<typeof buttonStyles>[0]) {
  return cn(buttonStyles(props))
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonStyles>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  )
}

export { Button, buttonVariants }
