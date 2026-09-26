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
import Developers from './pages/Developers'
import Docs from './pages/Docs'
import { usePaymentsInvalidation } from './lib/queries'

export default function App() {
  const location = useLocation()
  // Credits also move outside this app (a Dodo Payments webhook grants them
  // after checkout completes on Dodo's domain), so billing queries are invalidated
  // from one place at the root rather than per page.
  usePaymentsInvalidation()
  return (
    // Every route below is signed-in only, and the gate is AppShell itself —
    // a visitor with no session never reaches the router, they are handed back
    // to the landing site. There are deliberately no per-route guards any more:
    // this deployment has no public page to guard the others from, and a guard
    // per route is a guard the next route can forget.
    <AppShell>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Home />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/developers" element={<Developers />} />
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
