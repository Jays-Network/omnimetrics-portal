import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface NeonButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean
}

/** Gradient pill: glow pulse, idle shine sweep, press feedback. Dark text on the gradient keeps AA. */
export const NeonButton = forwardRef<HTMLButtonElement, NeonButtonProps>(
  ({ className, children, loading, disabled, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} disabled={disabled || loading} className={cn('fx-neon', className)} {...props}>
      <span aria-hidden className="fx-neon-clip">
        <span className="fx-neon-shine" />
      </span>
      <span className="fx-neon-label">
        {loading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
        {children}
      </span>
    </button>
  ),
)
NeonButton.displayName = 'NeonButton'
