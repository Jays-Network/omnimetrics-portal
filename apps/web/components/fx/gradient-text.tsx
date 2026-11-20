import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** Cyan-blue-purple text. Large display text only (>= 24px, or 18.66px bold). The purple end is 4.7:1 on navy and 4.3:1 on surface, so never use it for body-size text. Use sparingly. */
export function GradientText({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('fx-gradient-text', className)} {...props} />
}
