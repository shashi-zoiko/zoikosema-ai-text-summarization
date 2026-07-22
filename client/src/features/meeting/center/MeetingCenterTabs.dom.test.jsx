// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MeetingCenterTabs from './MeetingCenterTabs.jsx'

const tabs = [
  { id: 'people', label: 'People', badge: 2 },
  { id: 'chat', label: 'Chat', badge: 0 },
]

describe('MeetingCenterTabs — WCAG tablist', () => {
  it('exposes tablist/tab roles with correct aria-selected + roving tabindex', () => {
    render(<MeetingCenterTabs tabs={tabs} activeTab="people" onSelect={() => {}} />)
    expect(screen.getByRole('tablist', { name: /meeting center sections/i })).toBeInTheDocument()
    const people = screen.getByRole('tab', { name: /people/i })
    const chat = screen.getByRole('tab', { name: /chat/i })
    expect(people).toHaveAttribute('aria-selected', 'true')
    expect(people).toHaveAttribute('tabindex', '0')
    expect(people).toHaveAttribute('aria-controls', 'zk-center-panel-people')
    expect(chat).toHaveAttribute('aria-selected', 'false')
    expect(chat).toHaveAttribute('tabindex', '-1')
  })

  it('shows a pending badge', () => {
    render(<MeetingCenterTabs tabs={tabs} activeTab="people" onSelect={() => {}} />)
    expect(screen.getByLabelText('2 pending')).toHaveTextContent('2')
  })

  it('ArrowRight moves focus (manual activation — does not select)', () => {
    const onSelect = vi.fn()
    render(<MeetingCenterTabs tabs={tabs} activeTab="people" onSelect={onSelect} />)
    const people = screen.getByRole('tab', { name: /people/i })
    people.focus()
    fireEvent.keyDown(people, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /chat/i })).toHaveFocus()
    expect(onSelect).not.toHaveBeenCalled() // manual activation
  })

  it('Enter/Space activates the focused tab', () => {
    const onSelect = vi.fn()
    render(<MeetingCenterTabs tabs={tabs} activeTab="people" onSelect={onSelect} />)
    const chat = screen.getByRole('tab', { name: /chat/i })
    chat.focus()
    fireEvent.keyDown(chat, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('chat')
  })

  it('click selects a tab', () => {
    const onSelect = vi.fn()
    render(<MeetingCenterTabs tabs={tabs} activeTab="people" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('tab', { name: /chat/i }))
    expect(onSelect).toHaveBeenCalledWith('chat')
  })
})
