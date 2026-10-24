import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Logo, { KALAMIO_ORANGE } from './Logo'

const paths = (svg) => [...svg.querySelectorAll('path')]

describe('Logo', () => {
  it('renders the mark and wordmark, named "Kalamio"', () => {
    render(<Logo />)
    const svg = screen.getByRole('img', { name: 'Kalamio' })

    expect(svg).toHaveAttribute('viewBox', '0 0 898 200')
    const [mark, wordmark] = paths(svg)
    expect(paths(svg)).toHaveLength(2)
    expect(mark).toHaveAttribute('fill', KALAMIO_ORANGE)
    // The wordmark follows the surrounding text colour so it works in both themes.
    expect(wordmark).toHaveAttribute('fill', 'currentColor')
  })

  it('renders only the square mark when wordmark is off', () => {
    render(<Logo wordmark={false} />)
    const svg = screen.getByRole('img', { name: 'Kalamio' })

    expect(svg).toHaveAttribute('viewBox', '0 0 200 200')
    expect(paths(svg)).toHaveLength(1)
    expect(paths(svg)[0]).toHaveAttribute('fill', KALAMIO_ORANGE)
  })

  it('is hidden from assistive tech when title is null', () => {
    const { container } = render(<Logo title={null} />)
    const svg = container.querySelector('svg')

    expect(screen.queryByRole('img')).toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('aria-label')
  })

  it('keeps its base class and passes extra props through', () => {
    const { container } = render(<Logo className="h-8" data-testid="logo" />)
    const svg = container.querySelector('svg')

    expect(svg).toHaveClass('kalamio-logo', 'h-8')
    expect(svg).toHaveAttribute('data-testid', 'logo')
  })
})
