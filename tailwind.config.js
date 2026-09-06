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
          canvas: '#0B0B1E',
          lift: '#1A1A2E',
          card: '#16162B',
          hairline: '#2A2A48',
          accent: '#6A32C9',
          'accent-end': '#B52286',
          success: '#10B981',
          tension: '#F43F5E',
          ink: '#F8FAFC',
          muted: '#A1A1B8',
          subtle: '#7B7B96',
          'accent-muted': '#C4B5FD',
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
        card: '0 24px 80px rgba(8, 6, 28, 0.45)',
      },
    },
  },
  plugins: [],
};
