/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        obsidian: {
          canvas: '#090D14',
          card: '#111827',
          hairline: '#1F2937',
          accent: '#38BDF8',
          success: '#10B981',
          tension: '#F43F5E',
          ink: '#F1F5F9',
          muted: '#94A3B8',
          subtle: '#64748B',
          'accent-muted': '#7DD3FC',
          'success-muted': '#6EE7B7',
          'tension-muted': '#FDA4AF',
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
        card: '0 16px 32px rgba(0, 0, 0, 0.16)',
      },
    },
  },
  plugins: [],
};
