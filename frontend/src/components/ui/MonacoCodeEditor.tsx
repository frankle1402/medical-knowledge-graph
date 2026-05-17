import Editor, { type OnChange } from '@monaco-editor/react';

interface MonacoCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Monaco language id, e.g. 'json', 'plaintext'. */
  language?: string;
  height?: number;
  ariaLabel?: string;
  readOnly?: boolean;
  testId?: string;
}

/**
 * Thin wrapper around @monaco-editor/react so tests can mock a single import.
 * The `ariaLabel` prop is also forwarded to the underlying editor (via a
 * non-standard prop the test mock can read) so test code can locate the
 * editor with `getByLabelText`.
 */
export function MonacoCodeEditor({
  value,
  onChange,
  language = 'plaintext',
  height = 220,
  ariaLabel,
  readOnly = false,
  testId,
}: MonacoCodeEditorProps) {
  const handleChange: OnChange = (next) => onChange(next ?? '');
  return (
    <div
      data-testid={testId}
      style={{
        border: '1px solid #d1d5db',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      <Editor
        value={value}
        onChange={handleChange}
        language={language}
        height={height}
        // The real Editor doesn't have a top-level aria-label prop, but the
        // test mock reads it. The runtime cost of sending an unknown prop is nil.
        {...({ 'aria-label': ariaLabel } as { 'aria-label'?: string })}
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          tabSize: 2,
          wordWrap: 'on',
          automaticLayout: true,
        }}
      />
    </div>
  );
}
