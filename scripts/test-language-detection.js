/**
 * Test Script: Language Detection
 *
 * Tests the franc language detection to verify it correctly identifies English vs other languages
 *
 * Usage:
 *   node scripts/test-language-detection.js
 */

import { franc } from 'franc';

const testCases = [
  {
    text: "Check engine oil level every 100 hours",
    expectedLang: "eng",
    label: "English - Simple maintenance task"
  },
  {
    text: "Inspect and clean the air filter monthly",
    expectedLang: "eng",
    label: "English - Regular inspection"
  },
  {
    text: "Motorölstand alle 100 Stunden prüfen",
    expectedLang: "deu",
    label: "German - Oil check"
  },
  {
    text: "Vérifier le niveau d'huile toutes les 100 heures",
    expectedLang: "fra",
    label: "French - Oil check"
  },
  {
    text: "Controllare il livello dell'olio ogni 100 ore",
    expectedLang: "ita",
    label: "Italian - Oil check"
  },
  {
    text: "Comprobar el nivel de aceite cada 100 horas",
    expectedLang: "spa",
    label: "Spanish - Oil check"
  },
  {
    text: "Replace filter",
    expectedLang: "eng",
    label: "English - Very short (borderline)"
  },
  {
    text: "A B C D E F G",
    expectedLang: "und",
    label: "Undetermined - Too short/gibberish"
  }
];

console.log('\n' + '='.repeat(80));
console.log('🧪 TESTING LANGUAGE DETECTION');
console.log('='.repeat(80) + '\n');

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
  const detected = franc(test.text, { minLength: 10 });
  const isCorrect = detected === test.expectedLang;

  if (isCorrect) {
    console.log(`✅ Test ${index + 1}: ${test.label}`);
    console.log(`   Text: "${test.text}"`);
    console.log(`   Detected: ${detected} (Expected: ${test.expectedLang})`);
    passed++;
  } else {
    console.log(`❌ Test ${index + 1}: ${test.label}`);
    console.log(`   Text: "${test.text}"`);
    console.log(`   Detected: ${detected} (Expected: ${test.expectedLang})`);
    failed++;
  }
  console.log('');
});

console.log('='.repeat(80));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(80) + '\n');

// Test the isEnglish function logic
console.log('Testing isEnglish() logic:\n');

function isEnglish(text) {
  if (!text || text.trim().length < 10) {
    return true; // Too short, assume English
  }

  const detectedLang = franc(text, { minLength: 10 });

  if (detectedLang === 'und') {
    return true; // Undetermined, assume English
  }

  return detectedLang === 'eng';
}

const englishTestCases = [
  { text: "Check engine oil level every 100 hours", shouldPass: true },
  { text: "Motorölstand alle 100 Stunden prüfen", shouldPass: false },
  { text: "Vérifier le niveau d'huile", shouldPass: false },
  { text: "Short", shouldPass: true }, // Too short, assume English
  { text: "Replace", shouldPass: true }, // Too short, assume English
];

englishTestCases.forEach((test, index) => {
  const result = isEnglish(test.text);
  const status = result === test.shouldPass ? '✅' : '❌';

  console.log(`${status} isEnglish("${test.text}") = ${result} (expected: ${test.shouldPass})`);
});

console.log('\n✅ Language detection test complete!\n');
