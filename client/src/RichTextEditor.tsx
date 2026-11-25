import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rte-toolbar-btn${active ? " is-active" : ""}`}
      aria-pressed={active ? true : undefined}
      disabled={disabled}
      onMouseDown={(event) => {
        // Keep editor selection so mark toggles apply to the current range.
        event.preventDefault();
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function normalizeEditorHtml(html: string) {
  return html === "<p></p>" ? "" : html;
}

export function RichTextEditor({ value, onChange, placeholder, disabled }: Props) {
  const lastEmittedHtml = useRef(value || "");

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        strike: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
    ],
    content: value || "",
    editable: !disabled,
    editorProps: {
      attributes: {
        class: "rte-content rich-story detail-caption",
        "aria-label": "Story",
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
      },
    },
    onUpdate: ({ editor: current }) => {
      const html = current.isEmpty ? "" : normalizeEditorHtml(current.getHTML());
      lastEmittedHtml.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    const next = value || "";
    if (next === lastEmittedHtml.current) return;
    lastEmittedHtml.current = next;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return <div className="rte-shell rte-loading">Loading editor…</div>;

  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const next = window.prompt("Link URL", previous || "https://");
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };

  return (
    <div className={`rte-shell${disabled ? " is-disabled" : ""}`}>
      <div className="rte-toolbar" role="toolbar" aria-label="Story formatting">
        <ToolbarButton
          label="Paragraph"
          active={editor.isActive("paragraph")}
          disabled={disabled}
          onClick={() => editor.chain().focus().setParagraph().run()}
        />
        <ToolbarButton
          label="H2"
          active={editor.isActive("heading", { level: 2 })}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarButton
          label="H3"
          active={editor.isActive("heading", { level: 3 })}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        />
        <span className="rte-toolbar-sep" aria-hidden="true" />
        <ToolbarButton
          label="Bold"
          active={editor.isActive("bold")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="Italic"
          active={editor.isActive("italic")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="Link"
          active={editor.isActive("link")}
          disabled={disabled}
          onClick={setLink}
        />
        <span className="rte-toolbar-sep" aria-hidden="true" />
        <ToolbarButton
          label="Bullets"
          active={editor.isActive("bulletList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="Numbers"
          active={editor.isActive("orderedList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <span className="rte-toolbar-sep" aria-hidden="true" />
        <ToolbarButton
          label="Undo"
          disabled={disabled || !editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolbarButton
          label="Redo"
          disabled={disabled || !editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
