'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { EmojiPicker } from './EmojiPicker'
import { EMOJI_DATA, emojiMatches } from './emojiData'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'

/** Type-safe accessor for tiptap-markdown storage */
interface MarkdownStorage {
  markdown: { getMarkdown: () => string }
}
function getEditorMarkdown(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return ''
  return (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown()
}

import { apiFetch } from '@/lib/api/apiClient'
import { executeSlashCommand, getSlashCommands } from '@/lib/comms/slashCommands'
import { expandComposerSlash, getClientSlashCommands, type SlashMeUser } from '@/lib/messaging/composerSlash'
import { useWorkspaceSlashCommands } from '@/lib/ui/useWorkspaceSlashCommands'
import { getDraft, saveDraft, clearDraft } from '@/lib/messaging/messageDrafts'
import { SendLaterMenu, SendLaterTrigger } from './SendLaterMenu'
import {
  Bold, Italic, Strikethrough, Link2, Code, List, ListOrdered, FileCode, Quote, Paperclip, SendHorizontal, X, Smile, Mic, Video, Maximize2, Minimize2
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
  /** Called when the user wants to record an audio clip. */
  onRecordAudio?: () => void
  /** Called when the user wants to record a video clip. */
  onRecordVideo?: () => void
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MENTION_MAX = 8
const EMOJI_MAX = 8

function mentionLabel(u: MentionCandidate): string {
  const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
  return full || u.nickname || u.username
}

/** Subtle vertical divider separating logical toolbar groups. */
function ToolbarSeparator() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 1,
        alignSelf: 'stretch',
        margin: '4px 4px',
        background: 'var(--mm-border-subtle, var(--mm-border, rgba(0,0,0,0.1)))',
        flex: '0 0 auto'
      }}
    />
  )
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
    initialContent,
    onRecordAudio,
    onRecordVideo
  },
  ref
) {
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIdx, setMentionIdx] = useState(0)
  const [composerEmojiOpen, setComposerEmojiOpen] = useState(false)
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null)
  const [emojiIdx, setEmojiIdx] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sendLaterOpen, setSendLaterOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [slashIdx, setSlashIdx] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<{ id: string; name: string; progress: number; error?: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)
  
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
      // Notify parent + auto-save draft
      const md = getEditorMarkdown(editor)
      // Debounced auto-save via requestIdleCallback or setTimeout
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
      draftSaveTimer.current = setTimeout(() => {
        const draftKey = threadRootId || channelId
        if (draftKey && !editMode) saveDraft(draftKey, md)
      }, 500)
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
        // Emoji ":" autocomplete detection
        const emojiMatch = /(?:^|\s):([a-zA-Z0-9_+-]{1,20})$/.exec(textBefore)
        if (emojiMatch) {
          setEmojiQuery(emojiMatch[1])
          setEmojiIdx(0)
        } else {
          setEmojiQuery(null)
        }

        // Slash command detection (only at start of message)
        const fullText = editor.getText().trim()
        if (fullText.startsWith('/')) {
          const slashPart = fullText.split(/\s/)[0].slice(1)
          setSlashQuery(slashPart)
          setSlashIdx(0)
        } else {
          setSlashQuery(null)
        }
      } else {
        setMentionQuery(null)
        setEmojiQuery(null)
        setSlashQuery(null)
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

  // ── Auto-restore draft when switching channels ────────────────────────
  useEffect(() => {
    if (!editor || editMode || initialContent) return
    const draftKey = threadRootId || channelId
    if (!draftKey) return
    const saved = getDraft(draftKey)
    if (saved) {
      editor.commands.setContent(saved)
    } else {
      editor.commands.clearContent()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, threadRootId, editor])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
    }
  }, [])

  // ── Mention candidates filtered by prefix query ─────────────────────────
  // Include group mentions: @here (online users), @channel (everyone), @all (everyone)
  const GROUP_MENTIONS: MentionCandidate[] = [
    { id: '__here__', username: 'here', first_name: 'Notify', last_name: 'online users in this channel' },
    { id: '__channel__', username: 'channel', first_name: 'Notify', last_name: 'everyone in this channel' },
    { id: '__all__', username: 'all', first_name: 'Notify', last_name: 'everyone in this channel' }
  ]
  const mentionCandidates = mentionQuery !== null
    ? [
        ...GROUP_MENTIONS.filter(g => {
          const q = mentionQuery.toLowerCase()
          if (!q) return true
          return g.username.includes(q) || (g.first_name || '').toLowerCase().includes(q)
        }),
        ...teamMembers
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
      ].slice(0, MENTION_MAX)
    : []

  // ── Emoji candidates filtered by :query ─────────────────────────────────
  const emojiCandidates = emojiQuery !== null
    ? EMOJI_DATA
        .filter(e => emojiMatches(e, emojiQuery))
        .slice(0, EMOJI_MAX)
    : []

  // ── Slash command autocomplete ──────────────────────────────────────────
  // Source-of-truth merge: client-side commands (defined in `lib/composerSlash.ts`)
  // win on overlapping names so the description matches the client behavior.
  // Workspace-scoped custom commands are appended; their names cannot collide
  // with built-ins (the API rejects `conflicts_with_builtin`).
  const customCommands = useWorkspaceSlashCommands(workspaceId)
  const SLASH_COMMANDS = useMemo(() => {
    const client = getClientSlashCommands()
    const clientNames = new Set(client.map(c => c.name))
    const lib = getSlashCommands().filter(c => !clientNames.has(c.name))
    const known = new Set([...client.map(c => c.name), ...lib.map(c => c.name)])
    const custom = customCommands.filter(c => !known.has(c.name))
    return [...client, ...lib, ...custom]
      .map(c => {
        // Use an explicit syntax/usage field when present; otherwise derive a
        // simple hint from the command name so every entry shows how to invoke it.
        const explicit = typeof c.usage === 'string' ? c.usage.trim() : ''
        return {
          name: c.name,
          desc: c.description,
          usage: explicit || `/${c.name}`
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [customCommands])
  const SLASH_MAX = 8
  const slashCandidates = slashQuery !== null
    ? SLASH_COMMANDS.filter(c => {
        if (!slashQuery) return true
        return c.name.startsWith(slashQuery.toLowerCase())
      }).slice(0, SLASH_MAX)
    : []

  const pickSlashCommand = useCallback(
    (name: string) => {
      if (!editor) return
      editor.commands.clearContent()
      editor.chain().focus().insertContent(`/${name} `).run()
      setSlashQuery(null)
    },
    [editor]
  )

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

  // ── Apply emoji pick ───────────────────────────────────────────────────
  const pickEmoji = useCallback(
    (emoji: string) => {
      if (!editor || emojiQuery === null) return

      const { state } = editor
      const { selection } = state
      const { $from } = selection

      // Delete the :query (including the leading ":")
      const tr = state.tr.delete($from.pos - emojiQuery.length - 1, $from.pos)
      editor.view.dispatch(tr)

      // Insert emoji character
      editor.chain().focus().insertContent(emoji).run()
      setEmojiQuery(null)
    },
    [editor, emojiQuery]
  )

  // ── File upload helper with XHR progress tracking ──────────────────────
  const uploadFile = useCallback((file: File) => {
    const id = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    setPendingFiles(prev => [...prev, { id, name: file.name, progress: 0 }])

    const form = new FormData()
    form.append('workspace_id', workspaceId || '')
    form.append('file', file, file.name)

    const xhr = new XMLHttpRequest()
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100)
        setPendingFiles(prev => prev.map(f => f.id === id ? { ...f, progress: pct } : f))
      }
    })
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { document?: { id?: string; filename?: string } }
          if (data.document?.id && editor) {
            const docUrl = `/api/documents/${data.document.id}/download`
            const insert = `[${data.document.filename || file.name}](${docUrl})`
            editor.chain().focus().insertContent(insert).run()
          }
        } catch { /* ignore */ }
      } else {
        setPendingFiles(prev => prev.map(f => f.id === id ? { ...f, error: 'Upload failed' } : f))
        return
      }
      setPendingFiles(prev => prev.filter(f => f.id !== id))
    })
    xhr.addEventListener('error', () => {
      setPendingFiles(prev => prev.map(f => f.id === id ? { ...f, error: 'Network error' } : f))
    })
    xhr.open('POST', '/api/documents')
    // Include cookies
    xhr.withCredentials = true
    xhr.send(form)
  }, [workspaceId, editor])

  // ── Drag-and-drop handlers ─────────────────────────────────────────────
  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
    if (e.dataTransfer.types.includes('Files')) setDragOver(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current <= 0) { setDragOver(false); dragCounter.current = 0 }
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    dragCounter.current = 0
    const files = e.dataTransfer.files
    for (let i = 0; i < files.length; i++) {
      uploadFile(files[i])
    }
  }, [uploadFile])

  // ── File attach (desktop bridge + upload) ──────────────────────────────
  const handleAttach = useCallback(async () => {
    const bridge = window.aaelinkDesktop
    if (!bridge?.openFileDialog || !bridge?.readFileBytes) {
      // Web fallback: trigger the hidden file input
      fileInputRef.current?.click()
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
        const insert = `[${data.document.filename || fileName}](${docUrl})`
        editor.chain().focus().insertContent(insert).run()
      }
    }
  }, [workspaceId, editor])

  // ── Ephemeral toast for slash command feedback ──────────────────────────
  const [ephemeral, setEphemeral] = useState<string | null>(null)
  const ephemeralTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showEphemeral = useCallback((msg: string) => {
    setEphemeral(msg)
    if (ephemeralTimer.current) clearTimeout(ephemeralTimer.current)
    ephemeralTimer.current = setTimeout(() => setEphemeral(null), 5000)
  }, [])
  useEffect(() => {
    return () => { if (ephemeralTimer.current) clearTimeout(ephemeralTimer.current) }
  }, [])

  // ── Send handler (expand slash commands first) ──────────────────────────
  const handleSend = useCallback(() => {
    if (!editor) return
    const md = getEditorMarkdown(editor)
    const trimmed = md.trim()
    if (!trimmed) return

    const result = expandComposerSlash(trimmed, me)

    switch (result.kind) {
      case 'send':
        onSend(result.text)
        editor.commands.clearContent()
        clearDraft(threadRootId || channelId)
        break
      case 'clear-draft':
        editor.commands.clearContent()
        clearDraft(threadRootId || channelId)
        break
      case 'set-draft':
        editor.commands.setContent(result.text)
        break
      case 'open-shortcuts':
        // Future: open command palette
        break
      case 'async-command': {
        // Execute async slash commands (API calls)
        editor.commands.clearContent()
        clearDraft(threadRootId || channelId)
        void (async () => {
          const cmdResult = await executeSlashCommand(result.name, result.args, channelId)
          if (!cmdResult) {
            showEphemeral(`Unknown command: /${result.name}`)
            return
          }
          if (cmdResult.action === 'send' && cmdResult.text) {
            onSend(cmdResult.text)
          } else if (cmdResult.action === 'ephemeral' && cmdResult.text) {
            showEphemeral(cmdResult.text)
          }
        })()
        break
      }
    }
  }, [editor, me, onSend, channelId, threadRootId, showEphemeral])

  // ── Keyboard handler ────────────────────────────────────────────────────
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cmd/Ctrl+Shift+F → toggle expand
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setExpanded(v => !v)
        return
      }
      // Escape collapses expanded mode (only when no autocomplete is open)
      if (
        expanded &&
        e.key === 'Escape' &&
        mentionQuery === null &&
        emojiQuery === null &&
        slashQuery === null
      ) {
        e.preventDefault()
        setExpanded(false)
        return
      }
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

      // Emoji autocomplete navigation
      if (emojiQuery !== null && emojiCandidates.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setEmojiIdx(i => (i + 1) % emojiCandidates.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setEmojiIdx(i => (i - 1 + emojiCandidates.length) % emojiCandidates.length)
          return
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault()
          const pick = emojiCandidates[emojiIdx]
          if (pick) pickEmoji(pick.emoji)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setEmojiQuery(null)
          return
        }
      }

      // Slash command autocomplete navigation
      if (slashQuery !== null && slashCandidates.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSlashIdx(i => (i + 1) % slashCandidates.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSlashIdx(i => (i - 1 + slashCandidates.length) % slashCandidates.length)
          return
        }
        if (e.key === 'Tab') {
          e.preventDefault()
          const pick = slashCandidates[slashIdx]
          if (pick) pickSlashCommand(pick.name)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setSlashQuery(null)
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
      emojiQuery,
      emojiCandidates,
      emojiIdx,
      pickEmoji,
      slashQuery,
      slashCandidates,
      slashIdx,
      pickSlashCommand,
      handleSend,
      editMode,
      onCancelEdit,
      expanded,
    ]
  )

  return (
    <footer className={`composer${editMode ? ' composer--edit' : ''}${expanded ? ' composer--expanded' : ''}`}>
      {/* ── Slash command autocomplete popup ──────────────────────── */}
      {slashQuery !== null && slashCandidates.length > 0 ? (
        <div className="slash-autocomplete" role="listbox">
          {slashCandidates.map((cmd, idx) => (
            <button
              key={cmd.name}
              type="button"
              role="option"
              aria-selected={idx === slashIdx}
              className={`slash-autocomplete-item${idx === slashIdx ? ' slash-autocomplete-item--active' : ''}`}
              onMouseDown={e => {
                e.preventDefault()
                pickSlashCommand(cmd.name)
              }}
            >
              <strong>/{cmd.name}</strong>
              <small>{cmd.desc}</small>
              <code className="slash-autocomplete-usage" style={{
                fontSize: 11,
                fontFamily: 'var(--mm-font-mono, ui-monospace, monospace)',
                color: 'var(--mm-muted)',
                opacity: 0.85
              }}>{cmd.usage}</code>
            </button>
          ))}
        </div>
      ) : null}

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

      {/* ── Emoji autocomplete popup ────────────────────────────── */}
      {emojiQuery !== null && emojiCandidates.length > 0 ? (
        <div className="mention-popup emoji-autocomplete-popup" role="listbox">
          {emojiCandidates.map((e, idx) => (
            <button
              key={e.emoji}
              type="button"
              role="option"
              aria-selected={idx === emojiIdx}
              className={`mention-option${idx === emojiIdx ? ' mention-option--active' : ''}`}
              onMouseDown={ev => {
                ev.preventDefault()
                pickEmoji(e.emoji)
              }}
            >
              <span className="emoji-autocomplete-icon">{e.emoji}</span>
              <span className="mention-option-name">:{e.name}:</span>
            </button>
          ))}
        </div>
      ) : null}
      {/* ── Ephemeral command feedback ──────────────────────────────── */}
      {ephemeral ? (
        <div className="composer-ephemeral" role="status" aria-live="polite">
          <span>{ephemeral}</span>
          <button type="button" onClick={() => setEphemeral(null)} aria-label="Dismiss" style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px',
            color: 'var(--mm-muted)', fontSize: 12
          }}>✕</button>
        </div>
      ) : null}

      {/* ── Tiptap Editor ────────────────────────────────────────────── */}
      <div
        className={`tiptap-composer-wrap${dragOver ? ' tiptap-composer-wrap--drag' : ''}`}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {/* Drag overlay */}
        {dragOver && (
          <div className="composer-drag-overlay">
            <Paperclip size={24} />
            <span>Drop files to upload</span>
          </div>
        )}

        <div onKeyDown={onKeyDown}>
          <EditorContent editor={editor} />
        </div>

        {/* Hidden file input for web attach fallback */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.zip"
          style={{ display: 'none' }}
          onChange={e => {
            const files = e.target.files
            if (files) {
              for (let i = 0; i < files.length; i++) uploadFile(files[i])
            }
            e.target.value = ''
          }}
        />

        {/* Pending file upload strip */}
        {pendingFiles.length > 0 && (
          <div className="composer-file-strip">
            {pendingFiles.map(f => (
              <div key={f.id} className={`composer-file-item${f.error ? ' composer-file-item--error' : ''}`}>
                <Paperclip size={12} className="composer-file-icon" />
                <span className="composer-file-name">{f.name}</span>
                {f.error ? (
                  <span className="composer-file-error">{f.error}</span>
                ) : (
                  <div className="composer-file-progress">
                    <div className="composer-file-progress-bar" style={{ width: `${f.progress}%` }} />
                  </div>
                )}
                <button
                  type="button"
                  className="composer-file-remove"
                  onClick={() => setPendingFiles(prev => prev.filter(p => p.id !== f.id))}
                  aria-label={`Remove ${f.name}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
        <div className="composer-inline-actions">
          <div className="toolbar" role="toolbar" aria-label="Formatting">
            {/* Group: text formatting */}
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

            <ToolbarSeparator />

            {/* Group: block formatting */}
            <button type="button" title="Bullet list" onClick={() => editor?.chain().focus().toggleBulletList().run()}>
              <List size={16} />
            </button>
            <button type="button" title="Numbered list" onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
              <ListOrdered size={16} />
            </button>
            <button type="button" title="Block quote" onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
              <Quote size={16} />
            </button>
            <button type="button" title="Code block" onClick={() => editor?.chain().focus().toggleCodeBlock().run()}>
              <FileCode size={16} />
            </button>

            <ToolbarSeparator />

            {/* Group: emoji */}
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <button type="button" title="Emoji" onClick={() => setComposerEmojiOpen(o => !o)}>
                <Smile size={16} />
              </button>
              {composerEmojiOpen && (
                <div style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 1000, marginBottom: 4 }}>
                  <EmojiPicker
                    onSelect={(emoji) => {
                      editor?.commands.insertContent(emoji)
                      editor?.commands.focus()
                      setComposerEmojiOpen(false)
                    }}
                    onClose={() => setComposerEmojiOpen(false)}
                  />
                </div>
              )}
            </div>

            <ToolbarSeparator />

            {/* Group: media */}
            <button type="button" title="Attach file" onClick={() => void handleAttach()}>
              <Paperclip size={16} />
            </button>

            <ToolbarSeparator />

            {/* Group: expand */}
            <button
              type="button"
              title={expanded ? 'Collapse composer (⌘⇧F)' : 'Expand composer (⌘⇧F)'}
              aria-pressed={expanded}
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>

            {/* Group: clip (only when recording handlers are wired) */}
            {(onRecordAudio || onRecordVideo) && <ToolbarSeparator />}
            {onRecordAudio && (
              <button type="button" title="Record audio clip" onClick={onRecordAudio}>
                <Mic size={16} />
              </button>
            )}
            {onRecordVideo && (
              <button type="button" title="Record video clip" onClick={onRecordVideo}>
                <Video size={16} />
              </button>
            )}
          </div>
          <div className="toolbar-spacer" />
          {(() => {
            const charCount = editor?.getText()?.length ?? 0
            const MAX_CHARS = 4000
            const isOver = charCount > MAX_CHARS
            const ratio = MAX_CHARS > 0 ? Math.min(charCount / MAX_CHARS, 1) : 0
            const nearLimit = ratio >= 0.95
            const veryNear = ratio >= 0.98
            // Always show a muted counter; ramp color toward red as the limit
            // nears, then invert to a solid danger pill once the limit is exceeded.
            const counterColor = isOver
              ? '#fff'
              : veryNear
                ? 'var(--mm-danger, #d24b4e)'
                : nearLimit
                  ? 'var(--mm-warning, #c47d12)'
                  : 'var(--mm-muted)'
            return (
              <span
                className="composer-char-counter"
                style={{
                  fontSize: 11,
                  fontWeight: nearLimit ? 600 : 500,
                  fontVariantNumeric: 'tabular-nums',
                  padding: '2px 6px',
                  borderRadius: 8,
                  marginRight: 6,
                  color: counterColor,
                  background: isOver ? 'var(--mm-danger, #d24b4e)' : 'transparent',
                  transition: 'color 0.2s, background 0.2s, font-weight 0.2s'
                }}
                title={isOver ? `Message exceeds ${MAX_CHARS} character limit` : `${MAX_CHARS - charCount} characters remaining`}
              >
                {charCount.toLocaleString()}/{MAX_CHARS.toLocaleString()}
              </span>
            )
          })()}
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
            <>
            <button
              type="button"
              className="send-button"
              onClick={handleSend}
              title="Send message"
            >
              <SendHorizontal size={16} />
            </button>
            {!threadRootId && (
              <div style={{ position: 'relative' }}>
                <SendLaterTrigger onClick={() => setSendLaterOpen(o => !o)} />
                <SendLaterMenu
                  channelId={channelId}
                  open={sendLaterOpen}
                  onClose={() => setSendLaterOpen(false)}
                  onSchedule={async (sendAt) => {
                    if (!editor) return
                    const md = getEditorMarkdown(editor).trim()
                    if (!md) return
                    await apiFetch('/api/scheduled-messages', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        channel_id: channelId,
                        body: md,
                        send_at: sendAt,
                        root_id: threadRootId || ''
                      })
                    })
                    editor.commands.clearContent()
                    clearDraft(threadRootId || channelId)
                  }}
                />
              </div>
            )}
            </>
          )}
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
