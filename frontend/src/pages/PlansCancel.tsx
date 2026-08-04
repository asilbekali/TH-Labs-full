import { Link } from 'react-router-dom'
import Page from '../components/Page'

// Reached if a Payment Link's post-payment redirect is configured to send
// cancellations here (Payment Links have no dedicated cancel URL the way
// Checkout Sessions do — see PAYMENTS.md). Purely informational; no charge was
// made, so there is nothing to undo.
export default function PlansCancel() {
  return (
    <Page className="grid min-h-[60vh] place-items-center">
      <div className="card flex max-w-md flex-col items-center gap-4 p-10 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-sunken text-muted">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </div>
        <h1 className="text-xl font-semibold text-primary">Checkout canceled</h1>
        <p className="text-sm text-secondary">
          No payment was taken. You can pick a plan whenever you’re ready.
        </p>
        <Link to="/plans" className="btn-primary focusable mt-2 rounded-pill px-5 py-2.5 text-sm">
          Back to Plans
        </Link>
      </div>
    </Page>
  )
}
