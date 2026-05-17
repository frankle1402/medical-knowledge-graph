import { forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

const variantStyles: Record<Variant, React.CSSProperties> = {
  primary: { background: '#2563EB', color: 'white' },
  secondary: { background: '#E5E7EB', color: '#111827' },
  danger: { background: '#DC2626', color: 'white' },
  ghost: { background: 'transparent', color: '#374151' },
};

const sizeStyles: Record<Size, React.CSSProperties> = {
  sm: { padding: '4px 10px', fontSize: 12 },
  md: { padding: '6px 14px', fontSize: 13 },
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', style, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      style={{
        ...sizeStyles[size],
        ...variantStyles[variant],
        border: 'none',
        borderRadius: 6,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}
      {...props}
    />
  );
});
