import type { Spec } from '../src/types.ts';

export const validSpec: Spec = {
  title: 'Añadir micrófono al setup',
  summary: 'Añade un elemento a setup.json',
  stories: [
    {
      action: 'Ver el micrófono en la sección Setup',
      conditions: 'Siempre',
      permissions: 'Público',
      expected_result: 'Aparece con nombre y enlace',
    },
  ],
  must_respect: [{ path: 'brain/decisions/0001-datos-en-json.md', reason: 'Los datos viven en src/data' }],
  acceptance: [
    { id: 'A1', criterion: 'El elemento aparece', proof: 'test', evidence: 'tests/setup.test.ts pasa' },
  ],
  out_of_scope: ['Cambiar el diseño'],
  open_questions: [],
  brain_updates: [],
};
