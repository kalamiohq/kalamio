/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
    theme: {

        fontSize: {
            'xs': '11px',
            'sm': '12px',
            'base': '14px',
            'lg': '15px',
            'xl': '16px',
            '2xl': '20px',
            '3xl': '28px',
            '4xl': '38px',
            '5xl': '50px',
        },

        colors: {
            white:       'rgb(var(--c-white) / <alpha-value>)',
            black:       'rgb(var(--c-black) / <alpha-value>)',
            grey:        'rgb(var(--c-grey) / <alpha-value>)',
            'dark-grey': 'rgb(var(--c-dark-grey) / <alpha-value>)',
            red:         'rgb(var(--c-red) / <alpha-value>)',
            twitter:     'rgb(var(--c-twitter) / <alpha-value>)',
            brand:       'rgb(var(--c-brand) / <alpha-value>)',
            kalamio:     'rgb(var(--c-kalamio) / <alpha-value>)',
            'kalamio-text': 'rgb(var(--c-kalamio-text) / <alpha-value>)',
            'on-kalamio':   'rgb(var(--c-on-kalamio) / <alpha-value>)',
            accent:      'rgb(var(--c-accent) / <alpha-value>)',
            success:     'rgb(var(--c-success) / <alpha-value>)',
            warning:     'rgb(var(--c-warning) / <alpha-value>)',
            surface:     'rgb(var(--c-surface) / <alpha-value>)',
            border:      'rgb(var(--c-border) / <alpha-value>)',
            transparent: 'transparent',
            current:     'currentColor',
        },

        extend: {
            fontFamily: {
              sans: ["'DM Sans'", "sans-serif"],
              display: ["'EB Garamond'", "serif"],
              headline: ["'Playfair Display'", "serif"],
              inter: ["'Inter'", "sans-serif"],
              gelasio: ["'EB Garamond'", "serif"],
              merriweather: ["'Literata'", "'Merriweather'", "Charter", "Georgia", "serif"],
            },
            boxShadow: {
                'xs':   'var(--shadow-xs)',
                'sm':   'var(--shadow-sm)',
                'md':   'var(--shadow-md)',
                'lg':   'var(--shadow-lg)',
                'xl':   'var(--shadow-xl)',
                'glow': 'var(--shadow-glow)',
            },
            borderRadius: {
                'radius-sm':   'var(--radius-sm)',
                'radius-md':   'var(--radius-md)',
                'radius-lg':   'var(--radius-lg)',
                'radius-xl':   'var(--radius-xl)',
                'radius-full': 'var(--radius-full)',
            },
            transitionDuration: {
                '250': '250ms',
            },
        },

    },
    plugins: [],
};