const fs = require('fs');

const mockSchema = {
    types: [
        {
            kind: 'OBJECT',
            name: 'Query',
            fields: [
                {
                    name: 'product',
                    args: [
                        { name: 'id', type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'ID' } } }
                    ],
                    type: { kind: 'OBJECT', name: 'Product' }
                },
                {
                    name: 'products',
                    args: [],
                    type: { kind: 'NON_NULL', ofType: { kind: 'LIST', ofType: { kind: 'NON_NULL', ofType: { kind: 'OBJECT', name: 'Product' } } } }
                }
            ]
        },
        {
            kind: 'OBJECT',
            name: 'Product',
            fields: [
                { name: 'id', args: [], type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'ID' } } },
                { name: 'name', args: [], type: { kind: 'SCALAR', name: 'String' } }
            ]
        },
        {
            kind: 'INPUT_OBJECT',
            name: 'ProductInput',
            inputFields: [
                { name: 'name', type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'String' } } }
            ]
        },
        {
            kind: 'ENUM',
            name: 'ProductType',
            enumValues: [
                { name: 'PHYSICAL' },
                { name: 'DIGITAL' }
            ]
        }
    ]
};

const formatType = (typeObj) => {
    if (!typeObj) return 'Unknown';
    if (typeObj.kind === 'NON_NULL') return formatType(typeObj.ofType) + '!';
    if (typeObj.kind === 'LIST') return '[' + formatType(typeObj.ofType) + ']';
    return typeObj.name || 'Unknown';
};

let sdl = "";

// Filter out introspection types
const userTypes = mockSchema.types.filter(t => !t.name.startsWith('__'));

userTypes.forEach(type => {
    if (type.kind === 'OBJECT') {
        sdl += `type ${type.name} {\n`;
        if (type.fields) {
            type.fields.forEach(f => {
                let argsStr = "";
                if (f.args && f.args.length > 0) {
                    argsStr = "(" + f.args.map(a => `${a.name}: ${formatType(a.type)}`).join(", ") + ")";
                }
                sdl += `  ${f.name}${argsStr}: ${formatType(f.type)}\n`;
            });
        }
        sdl += `}\n\n`;
    } else if (type.kind === 'INPUT_OBJECT') {
        sdl += `input ${type.name} {\n`;
        if (type.inputFields) {
            type.inputFields.forEach(f => {
                sdl += `  ${f.name}: ${formatType(f.type)}\n`;
            });
        }
        sdl += `}\n\n`;
    } else if (type.kind === 'ENUM') {
        sdl += `enum ${type.name} {\n`;
        if (type.enumValues) {
            type.enumValues.forEach(v => {
                sdl += `  ${v.name}\n`;
            });
        }
        sdl += `}\n\n`;
    }
});

console.log(sdl.trim());
