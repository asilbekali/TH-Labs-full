import type { ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import SignInRequired from './components/SignInRequired'
import Studio from './pages/Studio'
import { useSession } from './lib/session-context'

function Page({ children }: { children: ReactNode }) {
  return (
    <motion.main
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.main>
  )
}

/**
 * Gate the Studio behind a session.
 *
 * `loading` renders nothing rather than a spinner: resuming a session is a
 * single request that usually resolves before first paint, and flashing a
 * spinner into an empty Studio and back out again is worse than a beat of
 * blankness.
 */
function Gate({ children }: { children: ReactNode }) {
  const { status } = useSession()
  if (status === 'loading') return null
  if (status === 'anonymous') return <SignInRequired />
  return <>{children}</>
}

export default function App() {
  const location = useLocation()
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      {/* The nav is fixed, so content clears it here rather than every page
          repeating the offset. */}
      <div className="flex-1 pt-20 sm:pt-24">
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route
              path="/"
              element={
                <Page>
                  <Gate>
                    <Studio />
                  </Gate>
                </Page>
              }
            />
            {/* Studio is the whole app now — send any other path home. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AnimatePresence>
      </div>
      <Footer />
    </div>
  )
}
