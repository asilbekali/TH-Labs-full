import { Component, type ReactNode } from 'react'
import { ask } from '../lib/messages'

interface State {
  error: Error | null
}

/**
 * A render crash would otherwise unmount everything and leave an empty popup.
 * Show what broke and a way out instead.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[TH-Labs popup]', error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <section className="glass card form">
        <p className="title">Something went wrong</p>
        <p className="error" role="alert">{error.message || String(error)}</p>
        <button className="btn btn-primary" type="button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => void ask({ type: 'auth/logout' }).finally(() => this.setState({ error: null }))}
        >
          Log out
        </button>
      </section>
    )
  }
}
