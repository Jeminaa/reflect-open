import { useKeymap } from '@meowdown/react'
import { TextSelection, type EditorState, type Transaction } from '@prosekit/pm/state'

/**
 * The document range of the line under the selection: the parent textblock's
 * inline content for prose, the newline-delimited line at the caret for code
 * blocks. Null when the selection spans blocks or sits outside a textblock.
 */
function currentLineRange(state: EditorState): { from: number; to: number } | null {
  const { $from, $to } = state.selection
  if (!$from.parent.isTextblock || !$from.sameParent($to)) {
    return null
  }
  const blockStart = $from.start()
  if ($from.parent.type.spec.code) {
    // A code block is text-only, so parent offsets index its text content
    // directly and the visual line is the newline-delimited span at the caret.
    const text = $from.parent.textContent
    const caret = $from.parentOffset
    const lineStart = caret === 0 ? 0 : text.lastIndexOf('\n', caret - 1) + 1
    const newlineAfter = text.indexOf('\n', caret)
    const lineEnd = newlineAfter === -1 ? text.length : newlineAfter
    return { from: blockStart + lineStart, to: blockStart + lineEnd }
  }
  return { from: blockStart, to: $from.end() }
}

/**
 * Select the full text of the line the caret (or a same-block selection) sits
 * on. Falls through — returns false without dispatching — on an empty line,
 * a cross-block selection, or when the line is already fully selected, so the
 * next Escape handler (meowdown's low-priority collapse) still runs and the
 * key toggles between "line selected" and "caret".
 */
export function selectCurrentLine(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const range = currentLineRange(state)
  if (range === null || range.from === range.to) {
    return false
  }
  if (state.selection.from === range.from && state.selection.to === range.to) {
    return false
  }
  dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, range.from, range.to)))
  return true
}

const SELECT_LINE_KEYMAP = { Escape: selectCurrentLine }

/**
 * Binds Escape inside the editor's ProseKit context to {@link selectCurrentLine}.
 * Default priority: below the task editor's exit-edit Escape (Priority.high)
 * and meowdown's pending-replacement discard, above meowdown's low-priority
 * selection collapse.
 */
export function SelectLineKeymap(): null {
  useKeymap(SELECT_LINE_KEYMAP)
  return null
}
