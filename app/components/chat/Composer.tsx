'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'

import { apiFetch } from '@/lib/apiClient'
import { expandComposerSlash, type SlashMeUser } from '@/lib/composerSlash'
import {
  Bold, Italic, Strikethrough, Link2, Code, List, Quote, Paperclip, SendHorizontal, X, Smile
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ComposerHandle {
  focus: () => void
  /** Replace draft text from outside (e.g. edit‑message restore). */
  setDraft: (text: string) => void
}

interface MentionCandidate {
  id: string
  username: string
  first_name?: string
  last_name?: string
  nickname?: string
}

interface ComposerProps {
  channelId: string
  channelTitle: string
  channelType?: string
  me: SlashMeUser | null
  /** Workspace ID — used for file uploads to `/api/documents`. */
  workspaceId?: string
  /** All members of the workspace (for @-mention autocomplete). */
  teamMembers: MentionCandidate[]
  /** Called when the composer wants to send a message. */
  onSend: (text: string) => void
  /** Called on every draft change (enables external typing-indicator emitting). */
  onDraftChange?: (text: string) => void
  /** Thread root id for thread-reply composers. */
  threadRootId?: string
  /** Placeholder override. */
  placeholder?: string
  /** If true, the composer is in "edit" mode. */
  editMode?: boolean
  onCancelEdit?: () => void
  /** Initial text for the composer (e.g. when editing). */
  initialContent?: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MENTION_MAX = 8

function mentionLabel(u: MentionCandidate): string {
  const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
  return full || u.nickname || u.username
}

// ── Component ──────────────────────────────────────────────────────────────────

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    channelId,
    channelTitle,
    channelType,
    me,
    workspaceId,
    teamMembers,
    onSend,
    onDraftChange,
    threadRootId,
    placeholder,
    editMode,
    onCancelEdit,
    initialContent
  },
  ref
) {
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIdx, setMentionIdx] = useState(0)
  
  const defaultPlaceholder = placeholder
    || `Message ${channelType === 'D' ? '' : '#'}${channelTitle}`

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: 'mm-code-block' } },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'mm-rich-link' },
      }),
      Placeholder.configure({
        placeholder: defaultPlaceholder,
      }),
      Markdown.configure({
        html: false,
        linkify: false, // Prevent tiptap-markdown from adding its own Link extension
      })
    ],
    content: initialContent || '',
    onUpdate: ({ editor }) => {
      // Notify parent
      const md = (editor.storage as any).markdown.getMarkdown()
      onDraftChange?.(md)
      
      // Check for mentions
      const { state } = editor
      const { selection } = state
      const { $from, empty } = selection
      if (empty) {
        const textBefore = $from.parent.textBetween(Math.max(0, $from.parentOffset - 20), $from.parentOffset, undefined, '\\ufffc')
        const match = /(?:^|\\s)@([a-zA-Z0-9._-]*)$/.exec(textBefore)
        if (match) {
          setMentionQuery(match[1] || '')
          setMentionIdx(0)
        } else {
          setMentionQuery(null)
        }
      } else {
        setMentionQuery(null)
      }
    },
  })

  // Expose handle to parent for programmatic control.
  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.commands.focus(),
      setDraft: (text: string) => {
        editor?.commands.setContent(text)
        onDraftChange?.(text)
      }
    }),
    [editor, onDraftChange]
  )

  // ── Mention candidates filtered by prefix query ─────────────────────────
  const mentionCandidates = mentionQuery !== null
    ? teamMembers
        .filter(u => {
          const q = mentionQuery.toLowerCase()
          if (!q) return true
          return (
            u.username.toLowerCase().includes(q) ||
            (u.first_name || '').toLowerCase().includes(q) ||
            (u.last_name || '').toLowerCase().includes(q) ||
            (u.nickname || '').toLowerCase().includes(q)
          )
        })
        .slice(0, MENTION_MAX)
    : []

  // ── Apply link insert ──────────────────────────────────────────────────
  const applyLink = useCallback(() => {
    if (!editor) return
    const url = linkUrl.trim()
    if (!url) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
    setLinkModalOpen(false)
    setLinkUrl('')
  }, [editor, linkUrl])

  // ── Apply mention pick ─────────────────────────────────────────────────
  const pickMention = useCallback(
    (username: string) => {
      if (!editor || mentionQuery === null) return
      
      const { state } = editor
      const { selection } = state
      const { $from } = selection
      
      // Delete the @query
      const tr = state.tr.delete($from.pos - mentionQuery.length - 1, $from.pos)
      editor.view.dispatch(tr)
      
      // Insert username
      editor.chain().focus().insertContent(`@${username} `).run()
      setMentionQuery(null)
    },
    [editor, mentionQuery]
  )

  // ── File attach (desktop bridge + upload) ──────────────────────────────
  const handleAttach = useCallback(async () => {
    const bridge = window.aaelinkDesktop
    if (!bridge?.openFileDialog || !bridge?.readFileBytes) {
      // Web fallback: use a temporary <input type="file"> element
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.zip'
      input.onchange = async () => {
        const webFile = input.files?.[0]
        if (!webFile) return
        const form = new FormData()
        form.append('workspace_id', workspaceId || '')
        form.append('file', webFile, webFile.name)
        const uploadRes = await apiFetch('/api/documents', {
          method: 'POST',
          body: form
        })
        if (uploadRes.ok) {
          const data = (await uploadRes.json()) as { document?: { id?: string; filename?: string } }
          if (data.document?.id && editor) {
            const docUrl = `/api/documents/${data.document.id}/download`
            const insert = `[📎 ${data.document.filename || webFile.name}](${docUrl})`
            editor.chain().focus().insertContent(insert).run()
          }
        } else if (editor) {
          editor.chain().focus().insertContent(`[📎 ${webFile.name} – upload failed]`).run()
        }
      }
      input.click()
      return
    }
    const res = await bridge.openFileDialog({
      properties: ['openFile'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx'] }
      ]
    })
    if (res.canceled || !res.filePaths[0]) return

    const filePath = res.filePaths[0]
    const fileName = filePath.split('/').pop() || filePath.split('\\\\').pop() || 'file'
    const bytes = await bridge.readFileBytes(filePath)
    if (!bytes.ok || !bytes.base64) return

    const byteChars = atob(bytes.base64)
    const byteArray = new Uint8Array(byteChars.length)
    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
    const blob = new Blob([byteArray])

    const form = new FormData()
    form.append('workspace_id', workspaceId || '')
    form.append('file', blob, fileName)

    const uploadRes = await apiFetch('/api/documents', {
      method: 'POST',
      body: form
    })
    if (uploadRes.ok) {
      const data = (await uploadRes.json()) as { document?: { id?: string; filename?: string } }
      if (data.document?.id && editor) {
        const docUrl = `/api/documents/${data.document.id}`
        const insert = `[📎 ${data.document.filename || fileName}](${docUrl})`
        editor.chain().focus().insertContent(insert).run()
      }
    }
  }, [workspaceId, editor])

  // ── Send handler (expand slash commands first) ──────────────────────────
  const handleSend = useCallback(() => {
    if (!editor) return
    const md = (editor.storage as any).markdown.getMarkdown()
    const trimmed = md.trim()
    if (!trimmed) return

    const result = expandComposerSlash(trimmed, me)

    switch (result.kind) {
      case 'send':
        onSend(result.text)
        editor.commands.clearContent()
        break
      case 'clear-draft':
        editor.commands.clearContent()
        break
      case 'set-draft':
        editor.commands.setContent(result.text)
        break
      case 'open-shortcuts':
        // Future: open command palette
        break
    }
  }, [editor, me, onSend])

  // ── Keyboard handler ────────────────────────────────────────────────────
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Mention autocomplete navigation
      if (mentionQuery !== null && mentionCandidates.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setMentionIdx(i => (i + 1) % mentionCandidates.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setMentionIdx(i => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
          return
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault()
          const pick = mentionCandidates[mentionIdx]
          if (pick) pickMention(pick.username)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setMentionQuery(null)
          return
        }
      }

      // Send on Enter (no shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
        return
      }

      // Cancel edit on Escape
      if (editMode && e.key === 'Escape') {
        e.preventDefault()
        onCancelEdit?.()
        return
      }
    },
    [
      mentionQuery,
      mentionCandidates,
      mentionIdx,
      pickMention,
      handleSend,
      editMode,
      onCancelEdit,
    ]
  )

  return (
    <footer className={`composer${editMode ? ' composer--edit' : ''}`}>
      {/* ── Mention autocomplete popup ──────────────────────────── */}
      {mentionQuery !== null && mentionCandidates.length > 0 ? (
        <div className="mention-popup" role="listbox">
          {mentionCandidates.map((u, idx) => (
            <button
              key={u.id}
              type="button"
              role="option"
              aria-selected={idx === mentionIdx}
              className={`mention-option${idx === mentionIdx ? ' mention-option--active' : ''}`}
              onMouseDown={e => {
                e.preventDefault()
                pickMention(u.username)
              }}
            >
              <span className="mention-option-avatar">
                {(u.username || '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="mention-option-name">{mentionLabel(u)}</span>
              <span className="mention-option-handle">@{u.username}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* ── Tiptap Editor ────────────────────────────────────────────── */}
      <div className="tiptap-composer-wrap">
        <div onKeyDown={onKeyDown}>
          <EditorContent editor={editor} />
        </div>
        <div className="composer-inline-actions">
          <div className="toolbar" role="toolbar" aria-label="Formatting">
            <button type="button" title="Bold (⌘B)" onClick={() => editor?.chain().focus().toggleBold().run()}>
              <Bold size={16} />
            </button>
            <button type="button" title="Italic (⌘I)" onClick={() => editor?.chain().focus().toggleItalic().run()}>
              <Italic size={16} />
            </button>
            <button type="button" title="Strikethrough" onClick={() => editor?.chain().focus().toggleStrike().run()}>
              <Strikethrough size={16} />
            </button>
            <button type="button" title="Insert link" onClick={() => setLinkModalOpen(true)}>
              <Link2 size={16} />
            </button>
            <button type="button" title="Inline code" onClick={() => editor?.chain().focus().toggleCode().run()}>
              <Code size={16} />
            </button>
            <button type="button" title="Emoji" onClick={() => { editor?.commands.insertContent('😊'); editor?.commands.focus() }}>
              <Smile size={16} />
            </button>
            <button type="button" title="Bullet list" onClick={() => editor?.chain().focus().toggleBulletList().run()}>
              <List size={16} />
            </button>
            <button type="button" title="Block quote" onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
              <Quote size={16} />
            </button>
            <button type="button" title="Attach file" onClick={() => void handleAttach()}>
              <Paperclip size={16} />
            </button>
          </div>
          <div className="toolbar-spacer" />
          {editMode ? (
            <>
              <button
                type="button"
                className="ghost-button"
                onClick={onCancelEdit}
                title="Cancel editing"
              >
                <X size={16} />
                <span>Cancel</span>
              </button>
              <button
                type="button"
                className="send-button"
                onClick={handleSend}
                title="Save edit"
              >
                <SendHorizontal size={16} />
                <span>Save</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="send-button"
              onClick={handleSend}
              title="Send message"
            >
              <SendHorizontal size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ── Link insert modal ───────────────────────────────────── */}
      {linkModalOpen ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => setLinkModalOpen(false)}
        >
          <div
            className="modal-panel slack-card"
            role="dialog"
            aria-modal="true"
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0 }}>Insert link</h2>
            <label className="field-label">
              URL
              <input
                className="slack-input"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    applyLink()
                  }
                }}
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setLinkModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="slack-button"
                onClick={applyLink}
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </footer>
  )
})
