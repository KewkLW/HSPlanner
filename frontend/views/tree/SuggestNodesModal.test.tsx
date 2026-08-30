import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BuildPerformanceDeps } from '../../utils/build/buildPerformance'
import { suggestNodesNative } from '../../utils/tree/nativeSuggest'
import SuggestNodesModal from './SuggestNodesModal'

vi.mock('../../utils/tree/nativeSuggest', () => ({
  suggestNodesNative: vi.fn(),
}))

const mockSuggestNodes = vi.mocked(suggestNodesNative)
const deps = {} as BuildPerformanceDeps

function nativeResult(nodeCount: number) {
  return {
    addedNodes: Array.from({ length: nodeCount }, (_, index) => index + 100),
    sequence: [],
    baseDps: 100,
    finalDps: 110,
    budgetUsed: nodeCount,
    budgetRequested: nodeCount,
    unsupportedLines: [],
    usedStarts: [],
  }
}

function modalProps(maxBudget: number) {
  return {
    currentAllocation: new Set<number>(),
    maxBudget,
    deps,
    onPreviewChange: vi.fn(),
    onApply: vi.fn(),
    onClose: vi.fn(),
  }
}

describe('SuggestNodesModal point-cap changes', () => {
  it('clamps the budget and clears a completed result when points shrink', async () => {
    const props = modalProps(12)
    mockSuggestNodes.mockResolvedValueOnce(nativeResult(8))
    const view = render(<SuggestNodesModal {...props} />)

    await userEvent.click(screen.getByRole('button', { name: 'Calculate' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()
    })
    expect(screen.getByText('8 nodes ready')).toBeInTheDocument()

    view.rerender(<SuggestNodesModal {...props} maxBudget={3} />)

    expect(screen.getByRole('spinbutton', { name: 'Nodes to Allocate' })).toHaveValue(3)
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.queryByText('8 nodes ready')).not.toBeInTheDocument()
    expect(props.onPreviewChange).toHaveBeenLastCalledWith(null)
  })

  it('disables calculation and application when no points remain', () => {
    const props = modalProps(0)
    render(<SuggestNodesModal {...props} />)

    expect(screen.getByRole('spinbutton', { name: 'Nodes to Allocate' })).toHaveValue(0)
    expect(screen.getByRole('spinbutton', { name: 'Nodes to Allocate' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Calculate' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByText('No points available')).toBeInTheDocument()
  })

  it('rejects a native result that exceeds the current point cap', async () => {
    const props = modalProps(3)
    mockSuggestNodes.mockResolvedValueOnce(nativeResult(4))
    render(<SuggestNodesModal {...props} />)

    await userEvent.click(screen.getByRole('button', { name: 'Calculate' }))

    expect(
      await screen.findByText(
        'Suggestion exceeded the available Incarnation points.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(props.onApply).not.toHaveBeenCalled()
    expect(props.onPreviewChange).toHaveBeenLastCalledWith(null)
  })
})
