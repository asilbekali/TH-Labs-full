import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import AppShell from './components/layout/AppShell'
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
  // Credits also move outside this app (a Stripe webhook grants them after
  // checkout completes on Stripe's domain), so billing queries are invalidated
  // from one place at the root rather than per page.
  usePaymentsInvalidation()
  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Home />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/plans/success" element={<PlansSuccess />} />
          <Route path="/plans/cancel" element={<PlansCancel />} />
          <Route path="/works" element={<MyWorks />} />
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
    </AppShell>
  )
}
