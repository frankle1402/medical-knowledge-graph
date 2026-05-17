import type { TemplateVariable } from '@mkg/shared';

export type VariableValue = string | number | boolean;

interface TemplateVariableEditorProps {
  variables: TemplateVariable[];
  values: Record<string, VariableValue>;
  onChange: (key: string, value: VariableValue) => void;
  /** Disable all inputs (e.g. while submitting). */
  disabled?: boolean;
  /** Validation errors keyed by variable.key. */
  errors?: Record<string, string>;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: 'white',
};

/**
 * Renders one form control per template variable, switching by `type`:
 *   text     → <input type="text">
 *   textarea → <textarea>
 *   select   → <select> over `options`
 *   number   → <input type="number">
 *   boolean  → <input type="checkbox">
 *
 * Used by both:
 *   - TemplatesPage preview pane (so admins see how variables render)
 *   - GraphEditorPage AIGenerateDialog (existing in-tree)
 */
export function TemplateVariableEditor({
  variables,
  values,
  onChange,
  disabled,
  errors,
}: TemplateVariableEditorProps) {
  if (variables.length === 0) {
    return (
      <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>该模板未声明变量。</p>
    );
  }

  return (
    <div data-testid="template-variable-editor">
      {variables.map((v) => {
        const value = values[v.key];
        const err = errors?.[v.key];
        const required = v.required;
        const fieldId = `var-${v.key}`;
        return (
          <label
            key={v.key}
            htmlFor={fieldId}
            style={{ display: 'block', marginBottom: 12 }}
          >
            <span
              style={{
                display: 'block',
                fontSize: 12,
                color: '#374151',
                marginBottom: 4,
              }}
            >
              {v.label}
              {required ? <span style={{ color: '#DC2626', marginLeft: 4 }}>*</span> : null}
              <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af' }}>{v.key}</span>
            </span>
            {renderControl(v, value, fieldId, onChange, disabled)}
            {err ? (
              <span style={{ fontSize: 12, color: '#DC2626', marginTop: 4, display: 'block' }}>
                {err}
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}

function renderControl(
  v: TemplateVariable,
  value: VariableValue | undefined,
  id: string,
  onChange: (key: string, value: VariableValue) => void,
  disabled: boolean | undefined,
): React.ReactNode {
  const common = {
    id,
    'aria-label': v.label,
    disabled,
    placeholder: v.placeholder,
  };
  switch (v.type) {
    case 'textarea':
      return (
        <textarea
          {...common}
          rows={4}
          value={(value ?? '') as string}
          onChange={(e) => onChange(v.key, e.target.value)}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
      );
    case 'select':
      return (
        <select
          {...common}
          value={(value ?? '') as string}
          onChange={(e) => onChange(v.key, e.target.value)}
          style={inputStyle}
        >
          <option value="">请选择…</option>
          {(v.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case 'number':
      return (
        <input
          {...common}
          type="number"
          value={value === undefined || value === '' ? '' : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(v.key, raw === '' ? '' : Number(raw));
          }}
          style={inputStyle}
        />
      );
    case 'boolean':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            {...common}
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(v.key, e.target.checked)}
          />
          <span style={{ fontSize: 12, color: '#6b7280' }}>{v.placeholder ?? ''}</span>
        </span>
      );
    case 'text':
    default:
      return (
        <input
          {...common}
          type="text"
          value={(value ?? '') as string}
          onChange={(e) => onChange(v.key, e.target.value)}
          style={inputStyle}
        />
      );
  }
}
