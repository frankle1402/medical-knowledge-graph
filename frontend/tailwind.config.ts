import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        node: {
          textbook: '#1E40AF',
          chapter: '#2563EB',
          section: '#3B82F6',
          knowledge_point: '#3B82F6',
          term: '#10B981',
          operation_step: '#F59E0B',
          competency: '#8B5CF6',
          image: '#EC4899',
          table: '#06B6D4',
          question: '#EF4444',
          case: '#92400E',
        },
      },
    },
  },
  plugins: [],
};

export default config;
