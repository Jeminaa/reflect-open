import type { ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MarkdownPreview } from '@/editor/markdown-preview.tsx'
import { useNoteAttachments } from '@/editor/use-note-attachments.ts'
import { splitFrontmatter, formatDayLabel } from '@reflect/core'
import type { NoteEntry } from '@reflect/app'
import { queryKeys } from '@/lib/query-client.ts'
import { useGraphInfo } from '@/providers/graph-provider.tsx'
import { useDateFormat } from '@/providers/settings-provider.tsx'
import { useCoreServices } from '@/services/services-provider.tsx'

/**
 * The palette's live preview pane: the highlighted result's markdown, read
 * straight from disk and rendered read-only. Keyed under the index scope so an
 * edit that re-indexes while the palette is open refreshes the preview too.
 *
 * A missing file is not an error here — daily suggestions are valid jump
 * targets before their file exists (the lazy contract) — it previews as Empty.
 */

interface NotePreviewProps {
  /** The highlighted palette entry to preview. */
  entry: NoteEntry
}

/**
 * Rendering cost is proportional to note size, and the preview mounts
 * synchronously with the highlight — a multi-hundred-KB note (a chat-log
 * import) freezes the palette input for seconds mid-keystroke. The preview is
 * a glance, not a reader, so cap what reaches the markdown renderer and say
 * so. Cut at a line break so the tail never renders half a block.
 */
const PREVIEW_CHAR_LIMIT = 20_000

interface PreviewSlice {
  readonly text: string
  readonly truncated: boolean
}

function sliceForPreview(body: string): PreviewSlice {
  if (body.length <= PREVIEW_CHAR_LIMIT) {
    return { text: body, truncated: false }
  }
  const head = body.slice(0, PREVIEW_CHAR_LIMIT)
  const lastBreak = head.lastIndexOf('\n')
  return { text: lastBreak > 0 ? head.slice(0, lastBreak) : head, truncated: true }
}

export function NotePreview({ entry }: NotePreviewProps): ReactElement {
  const graph = useGraphInfo()
  const dateFormat = useDateFormat()
  const { noteDocuments } = useCoreServices()
  const { resolveImageUrl, resolveWikiEmbed } = useNoteAttachments(entry.path)
  const { data, isError } = useQuery({
    queryKey: queryKeys.index.notePreview(graph?.root, entry.path),
    queryFn: () => noteDocuments.readSource(entry.path),
    enabled: graph !== null,
  })

  const body = data === null || data === undefined ? null : splitFrontmatter(data).body

  let content: ReactElement | null
  if (isError) {
    content = <p className="text-sm text-text-muted">This note can’t be previewed.</p>
  } else if (data === undefined) {
    content = null // still loading; blank beats a flash of the wrong state
  } else if (body === null || body.trim() === '') {
    content = <p className="text-sm text-text-muted italic">Empty</p>
  } else {
    const slice = sliceForPreview(body)
    content = (
      <>
        <MarkdownPreview
          content={slice.text}
          // Note links stay inert, like the preview's wiki link chips.
          sourcePath={null}
          resolveImageUrl={resolveImageUrl}
          resolveWikiEmbed={resolveWikiEmbed}
        />
        {slice.truncated ? (
          <p className="mt-3 text-sm text-text-muted italic">
            Preview truncated — open the note to read the rest.
          </p>
        ) : null}
      </>
    )
  }

  return (
    <div data-testid="palette-preview" className="h-full px-5 py-4">
      {entry.date !== null ? (
        <h2 className="mb-3 text-lg font-semibold">{formatDayLabel(entry.date, dateFormat)}</h2>
      ) : null}
      {content}
    </div>
  )
}
