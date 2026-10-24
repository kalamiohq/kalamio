import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Logo, { KALAMIO_ORANGE, KALAMIO_WHITE } from './Logo'

const paths = (svg) => [...svg.querySelectorAll('path')]

// The mark is an orange disc with a solid white K on top, never a see-through K.
const expectMark = (svg) => {
  expect(svg.querySelector('circle')).toHaveAttribute('fill', KALAMIO_ORANGE)
  expect(paths(svg)[0]).toHaveAttribute('fill', KALAMIO_WHITE)
}

describe('Logo', () => {
  it('renders the mark and wordmark, named "Kalamio"', () => {
    render(<Logo />)
    const svg = screen.getByRole('img', { name: 'Kalamio' })

    expect(svg).toHaveAttribute('viewBox', '0 0 898 200')
    expectMark(svg)
    expect(paths(svg)).toHaveLength(2)
    // The wordmark follows the surrounding text colour so it works in both themes.
    expect(paths(svg)[1]).toHaveAttribute('fill', 'currentColor')
  })

  it('renders only the square mark when wordmark is off', () => {
    render(<Logo wordmark={false} />)
    const svg = screen.getByRole('img', { name: 'Kalamio' })

    expect(svg).toHaveAttribute('viewBox', '0 0 200 200')
    expectMark(svg)
    expect(paths(svg)).toHaveLength(1)
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
