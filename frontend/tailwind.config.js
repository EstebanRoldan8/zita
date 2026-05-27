/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    { pattern: /bg-(blue|emerald|violet|red|amber|slate|indigo|pink|green|yellow)-(500|600)\/(5|10|15|20|30|40)/ },
    { pattern: /text-(blue|emerald|violet|red|amber|slate|indigo|pink|green|yellow)-(300|400|500)/ },
    { pattern: /border-(blue|emerald|violet|red|amber|slate|indigo|pink|green|yellow)-(500|600)\/(15|20|25|30|35|40|50)/ },
    { pattern: /hover:border-(blue|emerald|violet|red|amber|slate|indigo|pink|green|yellow)-(500|600)\/(20|35|40|50|60|70)/ },
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
