import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import { useCallback } from 'react'
import Icon from '../../../components/Icon'
import { cn } from '../../../lib/cn'

// PRIVATE rich-text notes (TipTap). Content is local-only and surfaced to the
// parent via onChange for autosave — nothing here is shared or broadcast.

export default function RichNotes({ initialContent, onChange }) {
  const editor = useEditor({
    // StarterKit v3 already bundles Underline and Link, so they are configured
    // here rather than added separately (adding them again = duplicate extensions).
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
      }),
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Your private meeting notes — only you can see these…' }),
    ],
    content: initialContent || '',
    autofocus: false,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange?.(editor.getJSON()),
    editorProps: {
      attributes: { class: 'zk-notes-editor focus:outline-none' },
    },
  })

  const setLink = useCallback(() => {
    if (!editor) return
    const prev = editor.getAttributes('link').href
    const url = window.prompt('Link URL', prev || 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  if (!editor) return null

  return (
    <div className="zk-notes flex h-full min-h-0 w-full flex-col" style={{ background: '#06060c' }}>
      {/* Toolbar */}
      <div
        className="z-5 flex shrink-0 flex-wrap items-center gap-0.5 border-b border-line px-3 py-2 backdrop-blur-md"
        style={{ background: 'rgba(15,15,23,0.9)' }}
      >
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1">
          <span className="text-[13px] font-bold">H1</span>
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
          <span className="text-[13px] font-bold">H2</span>
        </Btn>

        <Divider />

        <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Ctrl+B)">
          <span className="text-[14px] font-bold">B</span>
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (Ctrl+I)">
          <span className="text-[14px] italic">I</span>
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (Ctrl+U)">
          <span className="text-[14px] underline">U</span>
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} title="Highlight">
          <span className="rounded-[3px] bg-[#fbbf24] px-1 text-[12px] font-semibold text-black">H</span>
        </Btn>

        <Divider />

        <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
          <span className="text-[15px] leading-none">•</span>
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
          <span className="text-[11px] font-semibold">1.</span>
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="Checklist">
          <Icon name="check" size={15} />
        </Btn>

        <Divider />

        <Btn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code block">
          <span className="font-mono text-[12px]">{'<>'}</span>
        </Btn>
        <Btn onClick={setLink} active={editor.isActive('link')} title="Link">
          <Icon name="link" size={15} />
        </Btn>
      </div>

      {/* Editor surface */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

function Btn({ children, active, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active || undefined}
      className={cn(
        'grid h-8 min-w-8 place-items-center rounded-sm! border-transparent! p-1! shadow-none! transition hover:translate-y-0!',
        active
          ? 'bg-[color-mix(in_srgb,var(--c-accent)_22%,transparent)]! text-accent!'
          : 'bg-transparent! text-fg-muted! hover:bg-white/10! hover:text-fg!'
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="mx-1 h-[22px] w-px shrink-0 bg-line" />
}
