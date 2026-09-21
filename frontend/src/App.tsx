import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import AppShell from './components/layout/AppShell'
import RequireAuth from './components/RequireAuth'
import Home from './pages/Home'
import Studio from './pages/Studio'
import Plans from './pages/Plans'
import PlansSuccess from './pages/PlansSuccess'
import PlansCancel from './pages/PlansCancel'
import Account from './pages/Account'
import MyWorks from './pages/MyWorks'
import { usePaymentsInvalidation } from './lib/queries'

export default function App() {
  const location = useLocation()
  // Credits also move outside this app (a Dodo Payments webhook grants them
  // after checkout completes on Dodo's domain), so billing queries are invalidated
  // from one place at the root rather than per page.
  usePaymentsInvalidation()
  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Home />} />
          {/* Signed-in only. The Studio spends credits, and the other two show
              account-scoped data — the welcome email links straight here, and
              anyone with the URL used to land inside the app with no account.
              The gate lives on the route so the next protected page cannot
              forget to add it. */}
          <Route
            path="/studio"
            element={
              <RequireAuth title="Sign in to open the Studio">
                <Studio />
              </RequireAuth>
            }
          />
          <Route path="/plans" element={<Plans />} />
          <Route path="/plans/success" element={<PlansSuccess />} />
          <Route path="/plans/cancel" element={<PlansCancel />} />
          <Route
            path="/works"
            element={
              <RequireAuth title="Sign in to see your works">
                <MyWorks />
              </RequireAuth>
            }
          />
          <Route
            path="/account"
            element={
              <RequireAuth title="Sign in to view your account">
                <Account />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
    </AppShell>
  )
}
