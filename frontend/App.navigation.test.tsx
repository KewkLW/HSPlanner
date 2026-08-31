import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(false)),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

vi.mock('./components/buildSelect', () => ({
  AUTO_OPEN_KEY: 'test.auto-open',
  BuildSelect: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      Enter planner
    </button>
  ),
}))

vi.mock('./components/app/BottomBar', () => ({ default: () => null }))
vi.mock('./components/app/BuildsMenu', () => ({ default: () => null }))
vi.mock('./components/app/LeftStatsPanel', () => ({ default: () => null }))
vi.mock('./components/app/SeasonErrorBanner', () => ({ default: () => null }))
vi.mock('./components/app/SeasonSwitcher', () => ({ default: () => null }))
vi.mock('./components/app/SeasonToast', () => ({ default: () => null }))
vi.mock('./components/app/ShareButton', () => ({ default: () => null }))
vi.mock('./components/app/StorageErrorBanner', () => ({ default: () => null }))
vi.mock('./components/app/TutorialOverlay', () => ({ default: () => null }))
vi.mock('./components/ui/Logo', () => ({ default: () => null }))

vi.mock('./views/CharacterView', () => ({
  default: () => <div data-testid="character-view">Character view</div>,
}))
vi.mock('./views/SkillsView', () => ({
  default: () => <div data-testid="spec-view">Spec view</div>,
}))
vi.mock('./views/TreeView', () => ({
  default: () => <div data-testid="incarnation-view">Incarnation view</div>,
}))
vi.mock('./views/EtherView', () => ({
  default: () => <div data-testid="ether-view">Ether view</div>,
}))
vi.mock('./views/gear/GearView', () => ({ default: () => null }))
vi.mock('./views/MercView', () => ({ default: () => null }))
vi.mock('./views/StatsView', () => ({ default: () => null }))
vi.mock('./views/ConfigView', () => ({ default: () => null }))
vi.mock('./views/NotesView', () => ({ default: () => null }))
vi.mock('./views/filters/FiltersView', () => ({ default: () => null }))

vi.mock('./store/autoSave', () => ({ initAutoSave: vi.fn() }))
vi.mock('./store/settings', () => ({ initUiZoom: vi.fn() }))
vi.mock('./store/undoHistory', () => ({
  initUndoHistory: vi.fn(),
  redoLastChange: vi.fn(),
  undoLastChange: vi.fn(),
}))
vi.mock('./utils/shiftScroll', () => ({ initShiftScroll: vi.fn() }))
vi.mock('./utils/build/deepLink', () => ({
  createDeepLinkDispatcher: vi.fn(() => ({
    dispatchInitial: vi.fn(),
    dispatchLive: vi.fn(),
  })),
  getInitialDeepLinkUrls: vi.fn(() => Promise.resolve([])),
}))
vi.mock('./utils/preloadAssets', () => ({
  preloadSprites: vi.fn(() => new Promise<void>(() => {})),
}))

import App from './App'
import { useBuild } from './store/build'

describe('planner navigation identity', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useBuild.getState().resetBuild()
  })

  it('keeps Spec, Incarnation, and Ether labels, views, and loadout banks aligned', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Enter planner' }))

    const nav = screen.getByRole('navigation')
    expect(
      within(nav)
        .getAllByRole('button')
        .slice(0, 4)
        .map((button) => button.textContent?.trim()),
    ).toEqual(['Character', 'Spec', 'Incarnation', 'Ether'])

    fireEvent.click(within(nav).getByRole('button', { name: 'Spec' }))
    expect(screen.getByTestId('spec-view')).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Spec loadouts' }),
    ).toBeInTheDocument()

    fireEvent.click(within(nav).getByRole('button', { name: 'Ether' }))
    expect(screen.getByTestId('ether-view')).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Ether loadouts' }),
    ).toBeInTheDocument()

    fireEvent.click(within(nav).getByRole('button', { name: 'Incarnation' }))
    expect(screen.getByTestId('incarnation-view')).toBeInTheDocument()
    expect(screen.queryByTestId('ether-view')).not.toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Incarnation loadouts' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('group', { name: 'Ether loadouts' }),
    ).not.toBeInTheDocument()
  })
})
