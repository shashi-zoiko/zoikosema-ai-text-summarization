import { cn } from '../../lib/cn'

export default function Skeleton({ className }) {
  return <span aria-hidden className={cn('skeleton block', className)} />
}
