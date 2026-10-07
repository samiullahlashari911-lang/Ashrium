/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ash: {
          'canvas': 'rgb(var(--ash-canvas) / <alpha-value>)',
          'raised': 'rgb(var(--ash-raised) / <alpha-value>)',
          'surface': 'rgb(var(--ash-surface) / <alpha-value>)',
          'line': 'rgb(var(--ash-line) / <alpha-value>)',
          'ink': 'rgb(var(--ash-ink) / <alpha-value>)',
          'muted': 'rgb(var(--ash-muted) / <alpha-value>)',
          'subtle': 'rgb(var(--ash-subtle) / <alpha-value>)',
          'accent': 'rgb(var(--ash-accent) / <alpha-value>)',
          'accent-strong': 'rgb(var(--ash-accent-strong) / <alpha-value>)',
          'accent-soft': 'rgb(var(--ash-accent-soft) / <alpha-value>)',
          'success': 'rgb(var(--ash-success) / <alpha-value>)',
          'success-soft': 'rgb(var(--ash-success-soft) / <alpha-value>)',
          'tension': 'rgb(var(--ash-tension) / <alpha-value>)',
          'tension-soft': 'rgb(var(--ash-tension-soft) / <alpha-value>)',
          'mannequin': 'rgb(var(--ash-mannequin) / <alpha-value>)',
        },
        strain: {
          constricted: '#F43F5E',
          ideal: '#10B981',
          loose: '#38BDF8',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: [
          'var(--font-mono)',
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgba(29, 27, 34, 0.04), 0 12px 32px rgba(29, 27, 34, 0.06)',
        lift: '0 2px 6px rgba(29, 27, 34, 0.06), 0 24px 60px rgba(29, 27, 34, 0.10)',
        cta: '0 8px 24px rgba(106, 76, 245, 0.28)',
      },
    },
  },
  plugins: [],
};
