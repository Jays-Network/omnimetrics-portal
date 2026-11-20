import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Input with an animated conic border + glow on focus. At rest the edge is
 * --brand-border-strong (3:1+); on focus a solid 2px accent outline is always
 * drawn, whatever the fx level. `className` styles the wrapper.
 */
export const GlowInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <div className={cn('fx-gi', className)}>
      <span aria-hidden className="fx-gi-ring" />
      <input ref={ref} className="fx-gi-field" {...props} />
    </div>
  ),
)
GlowInput.displayName = 'GlowInput'
