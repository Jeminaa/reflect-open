import { createRef } from 'react'
import { expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderInApp } from '@/test-utils/render-in-app.tsx'
import { act } from '@/test-utils/act.ts'
import { NoteEditor, type NoteEditorHandle } from './note-editor.tsx'

it('extends ESC-selected bullets with real keys, contracts, deletes and undoes', async () => {
  const editor = createRef<NoteEditorHandle>()
  const { container } = await renderInApp(
    <NoteEditor handleRef={editor} initialContent={'- first\n  - child\n- second\n- third'} />,
  )
  await act(() => {
    editor.current?.focus()
    editor.current?.setSelection('start')
  })
  await userEvent.keyboard('{Escape}')
  await expect
    .poll(() => {
      return container.querySelectorAll('.ProseMirror-selectednode, .reflect-bullet-selected')
        .length
    })
    .toBe(1)
  expect(editor.current?.getSelectedText()).toContain('first')
  await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}')
  await expect
    .poll(() => {
      return container.querySelectorAll('.ProseMirror-selectednode, .reflect-bullet-selected')
        .length
    })
    .toBe(2)
  expect(editor.current?.getSelectedText()).toContain('second')
  await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}')
  await expect
    .poll(() => {
      return container.querySelectorAll('.ProseMirror-selectednode, .reflect-bullet-selected')
        .length
    })
    .toBe(1)
  await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}{Backspace}')
  await expect.poll(() => editor.current?.getMarkdown().trim()).toBe('- third')
  await userEvent.keyboard('{Meta>}z{/Meta}')
  await expect.poll(() => editor.current?.getMarkdown()).toContain('child')
})

it('extends upward repeatedly, stops at the edge, and collapses with Escape', async () => {
  const editor = createRef<NoteEditorHandle>()
  const { container } = await renderInApp(
    <NoteEditor handleRef={editor} initialContent={'- first\n- second\n- third'} />,
  )
  await act(() => {
    editor.current?.focus()
    editor.current?.setSelection('end')
  })
  await userEvent.keyboard('{Escape}{Shift>}{ArrowUp}{ArrowUp}{ArrowUp}{/Shift}')
  await expect.poll(() => container.querySelectorAll('.reflect-bullet-selected').length).toBe(3)
  expect(editor.current?.getSelectedText()).toContain('first')
  expect(editor.current?.getSelectedText()).toContain('third')
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => container.querySelectorAll('.reflect-bullet-selected').length).toBe(0)
  expect(editor.current?.getSelectedText()).toBe('')
})
