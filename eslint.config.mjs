import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

export default [
  ...nextCoreWebVitals,
  {
    rules: {
      '@next/next/no-img-element': 'warn',
      // Reglas de "React Compiler readiness" que trae eslint-plugin-react-hooks@7 (vía
      // eslint-config-next@16). Están pensadas para React 19 + el compilador; esta app sigue
      // en React 18 y el patrón useEffect(() => { fetchX() }, [...]) es válido y está por toda
      // la base (109 sitios). Adoptarlas es una decisión de política/arquitectura para cuando se
      // migre a React 19, no algo que deba colar en un bump de versión de ESLint — se desactivan
      // explícitamente en vez de dejarlas fallar en silencio o forzar un refactor masivo aquí.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/incompatible-library': 'off',
    },
  },
]
