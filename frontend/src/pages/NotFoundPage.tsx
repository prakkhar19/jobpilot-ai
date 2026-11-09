import { Link } from 'react-router-dom'
import { EmptyState, buttonClasses } from '@/components/ui'

export default function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you are looking for does not exist or was moved."
      action={
        <Link to="/" className={buttonClasses('primary')}>
          Go to dashboard
        </Link>
      }
    />
  )
}
