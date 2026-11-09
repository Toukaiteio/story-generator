import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#F2F2F7',
          1: '#FFFFFF',
          2: '#E5E5EA',
          3: '#D1D1D6',
          4: '#C7C7CC',
          5: '#AEAEB2',
        },
        line: 'rgba(0, 0, 0, 0.08)',
        text: {
          primary: '#1C1C1E',
          secondary: '#3C3C43',
          muted: '#8A8A8E',
          inverse: '#FFFFFF',
        },
        accent: {
          DEFAULT: '#007AFF',
          hover: '#0A84FF',
          muted: '#0062CC',
          subtle: '#EAF4FF',
        },
        success: {
          DEFAULT: '#34C759',
          subtle: '#EAF9EE',
        },
        warning: {
          DEFAULT: '#FF9F0A',
          subtle: '#FFF5E5',
        },
        danger: {
          DEFAULT: '#FF3B30',
          subtle: '#FFF0EF',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Noto Sans SC"',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          '"SF Mono"',
          '"JetBrains Mono"',
          '"Fira Code"',
          '"Cascadia Code"',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        meta: ['12px', { lineHeight: '16px' }],
        caption: ['13px', { lineHeight: '18px' }],
        body: ['15px', { lineHeight: '24px' }],
        title: ['20px', { lineHeight: '26px' }],
        display: ['24px', { lineHeight: '30px' }],
        '2xs': ['12px', { lineHeight: '16px' }],
        xs: ['13px', { lineHeight: '18px' }],
        sm: ['15px', { lineHeight: '24px' }],
        base: ['16px', { lineHeight: '26px' }],
        lg: ['20px', { lineHeight: '26px' }],
        xl: ['24px', { lineHeight: '30px' }],
        '2xl': ['28px', { lineHeight: '34px' }],
        '3xl': ['32px', { lineHeight: '38px' }],
      },
      borderRadius: {
        ios: '20px',
        'ios-lg': '28px',
      },
      boxShadow: {
        ios: '0 1px 3px rgba(0, 0, 0, 0.08), 0 8px 24px rgba(0, 0, 0, 0.04)',
        'ios-lg': '0 2px 8px rgba(0, 0, 0, 0.08), 0 24px 60px rgba(0, 0, 0, 0.10)',
        'ios-pill': '0 1px 2px rgba(0, 0, 0, 0.10), 0 4px 14px rgba(0, 0, 0, 0.06)',
      },
      animation: {
        'fade-in': 'fadeIn 150ms ease-out',
        'fade-in-up': 'fadeInUp 200ms ease-out',
        'fade-in-down': 'fadeInDown 200ms ease-out',
        'slide-in-left': 'slideInLeft 200ms ease-out',
        'slide-in-right': 'slideInRight 250ms ease-out',
        'scale-in': 'scaleIn 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'spin-slow': 'spin 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInDown: {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideInLeft: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        slideInRight: {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config
