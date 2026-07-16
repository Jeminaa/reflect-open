import { useKeymap } from '@meowdown/react'
import { NodeSelection, type EditorState, type Transaction } from '@prosekit/pm/state'

/**
 * The depth of the block to select for the caret's position: the ancestor
 * just above the caret's textblock (a flat-list bullet with its children, a
 * blockquote), or the textblock itself when its parent is the doc (plain
 * paragraph, heading, code block). Null when neither is selectable.
 */
function blockDepthFor(state: EditorState): number | null {
  const { $from } = state.selection
  const above = $from.depth - 1
  if (above >= 1 && NodeSelection.isSelectable($from.node(above))) {
    return above
  }
  if ($from.depth >= 1 && NodeSelection.isSelectable($from.parent)) {
    return $from.depth
  }
  return null
}

/**
 * Select the block under the caret as a node — the same selection the
 * drag-handle grip produces, so the block can be moved (Alt-↑/↓), deleted,
 * or replaced whole. Falls through — returns false without dispatching — when
 * a node is already selected or the selection spans blocks, so the next
 * Escape handler (meowdown's low-priority collapse) still runs and the key
 * toggles between "block selected" and "caret".
 */
export function selectCurrentBlock(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { selection } = state
  if (selection instanceof NodeSelection) {
    return false
  }
  const { $from, $to } = selection
  if (!$from.parent.isTextblock || !$from.sameParent($to)) {
    return false
  }
  const depth = blockDepthFor(state)
  if (depth === null) {
    return false
  }
  dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, $from.before(depth))))
  return true
}

const SELECT_BLOCK_KEYMAP = { Escape: selectCurrentBlock }

/**
 * Binds Escape inside the editor's ProseKit context to {@link selectCurrentBlock}.
 * Default priority: below the task editor's exit-edit Escape (Priority.high)
 * and meowdown's pending-replacement discard, above meowdown's low-priority
 * selection collapse.
 */
export function SelectBlockKeymap(): null {
  useKeymap(SELECT_BLOCK_KEYMAP)
  return null
}
