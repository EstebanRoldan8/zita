// Simulación del algoritmo buscar_servicio con datos típicos de barbería

// Funciones auxiliares copiadas de assistant.service.js
function normalize(text) {
  if (!text) return '';
  return text.toLowerCase().trim().replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n');
}

function calculateSimilarity(input, target) {
  const a = normalize(input);
  const b = normalize(target);
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1.0;
  const editDistance = getEditDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function getEditDistance(s1, s2) {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) costs[j] = j;
      else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

// Datos reales típicos de barbería
const servicios = [
  { id: '1', name: 'Corte clásico', price: 25000, duration_minutes: 30 },
  { id: '2', name: 'Corte + barba', price: 40000, duration_minutes: 45 },
  { id: '3', name: 'Corte degradado', price: 35000, duration_minutes: 40 },
  { id: '4', name: 'Afeitado', price: 15000, duration_minutes: 20 },
  { id: '5', name: 'Barba + corte', price: 50000, duration_minutes: 60 },
  { id: '6', name: 'Lavado', price: 10000, duration_minutes: 10 },
];

// Simular buscar_servicio con input "corte"
const searchInput = 'corte';
const normalizedSearch = normalize(searchInput);

console.log('=== SIMULACIÓN: buscar_servicio("corte") ===\n');
console.log('Entrada normalizada:', normalizedSearch);
console.log('\nServicios disponibles:');
servicios.forEach(s => console.log(`  - ${s.name}`));

// Filtrar matches (línea 1605-1607 del código)
const matches = servicios.filter(s =>
  normalize(s.name).includes(normalizedSearch) || normalizedSearch.split(' ').some(w => normalize(s.name).includes(w))
);

console.log(`\n✓ Coincidencias encontradas: ${matches.length}`);
matches.forEach(m => console.log(`  - ${m.name}`));

// Simular lo que hace la función
if (matches.length === 0) {
  console.log('\n❌ Retorna: { not_found: true }');
} else if (matches.length === 1) {
  console.log(`\n✓ Retorna: { found: true, service: "${matches[0].name}" }`);
  console.log('   (Sin ambigüedad, solo 1 match)');
} else {
  // AQUÍ ESTÁ EL PROBLEMA: calcula el "mejor" match y retorna SOLO ESE
  const bestMatch = matches.reduce((best, current) => {
    const currentScore = calculateSimilarity(searchInput, current.name);
    const bestScore = calculateSimilarity(searchInput, best.name);
    console.log(`    - "${current.name}": similaridad = ${currentScore.toFixed(3)}`);
    if (currentScore > bestScore) console.log(`      → es mejor que "${best.name}" (${bestScore.toFixed(3)})`);
    return currentScore > bestScore ? current : best;
  });

  console.log(`\n⚠️  PROBLEMA ENCONTRADO:`);
  console.log(`   La función ELIGE el "mejor match" automáticamente:`);
  console.log(`   Retorna: { found: true, service: "${bestMatch.name}" }`);
  console.log(`\n   NUNCA retorna múltiples candidatos como lo hace buscar_cliente.`);
  console.log(`   El modelo NUNCA se entera de que había ${matches.length} opciones.`);
  console.log(`   Por eso NO puede preguntar al usuario cuál prefiere.`);
}

console.log('\n=== COMPARACIÓN CON buscar_cliente ===');
console.log('buscar_cliente SI retorna:');
console.log('  { found: true, multiple_found: true, all_matches: [...] }');
console.log('\nbuscar_servicio NO retorna eso. Retorna solo el "mejor match".');
