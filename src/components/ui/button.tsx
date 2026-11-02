import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { type VariantProps, cva } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-base font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-blue-500 text-white shadow-sm hover:bg-blue-600 hover:shadow-md',
        destructive: 'bg-red-500 text-white shadow-sm hover:bg-red-600',
        outline:
          'border border-gray-200 bg-white text-gray-900 shadow-sm hover:bg-gray-50 hover:border-gray-300',
        secondary: 'bg-gray-100 text-gray-900 shadow-sm hover:bg-gray-200',
        ghost: 'text-gray-700 hover:bg-gray-100',
        link: 'text-blue-500 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-12 px-6 py-3',
        sm: 'h-9 px-3 py-2 text-sm',
        lg: 'h-14 px-8 py-4 text-lg',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends useRender.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {}

// 다른 요소로 그리려면 render 를 쓴다: <Button render={<Link href="/x" />}>이동</Button>
function Button({ className, variant, size, render, ...props }: ButtonProps) {
  return useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      { className: cn(buttonVariants({ variant, size, className })) },
      props,
    ),
  });
}

export { Button, buttonVariants };
