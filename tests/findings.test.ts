import { describe, it, expect } from 'vitest';
import { verifyFindings } from '../src/findings.ts';
import type { Finding } from '../src/types.ts';

const files: Record<string, string> = {
  'src/a.ts': 'const x = 1;\r\nif (user.isAdmin) {\r\n  run(  input );\r\n}\r\n',
};
const read = (p: string) => (p in files ? files[p] : null);
const f = (file: string, quote: string): Finding => ({ file, line: 2, severity: 'major', description: 'd', quote });

describe('verifyFindings', () => {
  it('mantiene hallazgos cuya cita existe', () => {
    const r = verifyFindings([f('src/a.ts', 'if (user.isAdmin) {')], read);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
  });
  it('tolera diferencias de espacios y CRLF en citas multilínea', () => {
    const r = verifyFindings([f('src/a.ts', 'if (user.isAdmin) {\n run( input );')], read);
    expect(r.kept).toHaveLength(1);
  });
  it('descarta citas inventadas', () => {
    const r = verifyFindings([f('src/a.ts', 'eval(input)')], read);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/cita/);
  });
  it('descarta archivos inexistentes', () => {
    const r = verifyFindings([f('src/nope.ts', 'x')], read);
    expect(r.dropped[0].reason).toMatch(/archivo/);
  });
  it('acepta rutas con ./ o barras invertidas', () => {
    expect(verifyFindings([f('./src\\a.ts', 'const x = 1;')], read).kept).toHaveLength(1);
  });
});
