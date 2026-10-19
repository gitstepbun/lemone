import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        lemone: { DEFAULT: '#FFCC00', hover: '#E6B800' },
        ink: '#1A1A1A',
        danger: '#B3261E',
        ok: '#1B7F3B',
        wait: '#B07A00',
        muted: '#6B7280',
        toast: '#FFFCF7',
      },
      borderRadius: { field: '10px', card: '14px', panel: '16px' },
      fontFamily: { sans: ['-apple-system', 'Segoe UI', 'Roboto', 'Inter', 'sans-serif'] },
    },
  },
  plugins: [],
};

export default config;
