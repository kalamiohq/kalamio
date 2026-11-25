import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Logo, { KALAMIO_ORANGE } from './Logo'

// The letters follow the text colour; the full stop (the "ink dot") is always Kalamio Orange.
const expectLogo = (svg) => {
  const paths = svg.querySelectorAll('path')
  const dots = svg.querySelectorAll('circle')

  expect(paths).toHaveLength(1)
  expect(paths[0]).toHaveAttribute('fill', 'currentColor')
  expect(dots).toHaveLength(1)
  expect(dots[0]).toHaveAttribute('fill', KALAMIO_ORANGE)
}

describe('Logo', () => {
  it('renders the "kalamio." wordmark, named "Kalamio"', () => {
    render(<Logo />)
    const svg = screen.getByRole('img', { name: 'Kalamio' })

    expect(svg).toHaveAttribute('viewBox', '0 0 797.22 200')
    expectLogo(svg)
  })

  it('renders only the square "k." mark when wordmark is off', () => {
    render(<Logo wordmark={false} />)
    const svg = screen.getByRole('img', { name: 'Kalamio' })

    expect(svg).toHaveAttribute('viewBox', '0 0 200 200')
    expectLogo(svg)
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
