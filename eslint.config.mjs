import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

const config = [
    ...nextCoreWebVitals,
    ...nextTypeScript,
    {
        files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'react/no-unescaped-entities': 'warn',
            'import/no-anonymous-default-export': 'off',
        },
    },
    {
        ignores: [
            'backups/**',
            'data/**',
            '.next/**',
            'out/**',
            'build/**',
        ],
    },
];

export default config;
