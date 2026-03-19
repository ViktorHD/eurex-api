const { getTypeName } = require('./app');

describe('getTypeName', () => {
    test('returns "Unknown" for null or undefined input', () => {
        expect(getTypeName(null)).toBe('Unknown');
        expect(getTypeName(undefined)).toBe('Unknown');
    });

    test('returns the name property if present', () => {
        const typeObj = { name: 'String', kind: 'SCALAR' };
        expect(getTypeName(typeObj)).toBe('String');
    });

    test('handles NON_NULL kind by appending "!"', () => {
        const typeObj = {
            kind: 'NON_NULL',
            ofType: { name: 'Int', kind: 'SCALAR' }
        };
        expect(getTypeName(typeObj)).toBe('Int!');
    });

    test('handles LIST kind by wrapping in "[]"', () => {
        const typeObj = {
            kind: 'LIST',
            ofType: { name: 'Float', kind: 'SCALAR' }
        };
        expect(getTypeName(typeObj)).toBe('[Float]');
    });

    test('handles nested combinations (e.g., non-null list of non-null strings)', () => {
        const typeObj = {
            kind: 'NON_NULL',
            ofType: {
                kind: 'LIST',
                ofType: {
                    kind: 'NON_NULL',
                    ofType: { name: 'String', kind: 'SCALAR' }
                }
            }
        };
        expect(getTypeName(typeObj)).toBe('[String!]!');
    });

    test('returns "Unknown" for objects without name and unknown kind', () => {
        const typeObj = { kind: 'OTHER' };
        expect(getTypeName(typeObj)).toBe('Unknown');
    });
});
