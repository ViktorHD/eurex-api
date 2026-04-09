import { getTypeName } from './ui.js';

export class SchemaExplorer {
    constructor(client, els, options) {
        this.client = client;
        this.els = els; // { docsTree, docsLoading, docsEmpty, docsSearch }
        this.options = options; // { onInsertField: (fieldName) => void, onSetQuery: (query) => void }
        this.schemaData = null;

        if (this.els.docsSearch) {
            this.els.docsSearch.addEventListener('input', () => {
                if (!this.schemaData) return;
                this.renderSchema(this.els.docsSearch.value.trim().toLowerCase());
            });
        }
    }

    async fetchSchema() {
        if (!this.client.apiKey || !this.client.endpoint) return null;

        this.els.docsLoading.classList.remove('hidden');
        this.els.docsEmpty.classList.add('hidden');
        this.els.docsTree.classList.add('hidden');

        const INTROSPECTION_QUERY = `
          query IntrospectionQuery {
            __schema {
              queryType { name }
              mutationType { name }
              types {
                kind
                name
                description
                fields {
                  name
                  description
                  type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
                  args { name description type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } defaultValue }
                }
                inputFields {
                  name
                  description
                  type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
                  defaultValue
                }
                enumValues { name description }
              }
            }
          }
        `;

        try {
            const data = await this.client.request(INTROSPECTION_QUERY, false);
            if (!data || !data.__schema) throw new Error("Invalid schema response.");
            this.schemaData = data.__schema;
            this.renderSchema('');
            return this.schemaData;
        } catch (err) {
            this.els.docsTree.innerHTML = '';
            const errP = document.createElement('div');
            errP.className = 'error-card';
            errP.innerHTML = `<div class="error-card-header"><i data-feather="alert-circle"></i> Error</div><p class="error-message"></p>`;
            errP.querySelector('.error-message').textContent = `Failed to load schema: ${err.message}`;
            if (window.feather) setTimeout(() => window.feather.replace(), 0);
            this.els.docsTree.appendChild(errP);
            this.els.docsTree.classList.remove('hidden');
            return null;
        } finally {
            this.els.docsLoading.classList.add('hidden');
        }
    }

    renderSchema(filter) {
        if (!this.schemaData) return;
        const schema = this.schemaData;

        this.els.docsTree.innerHTML = '';
        this.els.docsTree.classList.remove('hidden');
        this.els.docsEmpty.classList.add('hidden');

        const userTypes = schema.types.filter(t => !t.name.startsWith('__'));
        const queryTypeName = schema.queryType ? schema.queryType.name : null;
        const mutationTypeName = schema.mutationType ? schema.mutationType.name : null;

        const rootFieldMap = {};
        const queryType = schema.types.find(t => t.name === queryTypeName);
        if (queryType && queryType.fields) {
            queryType.fields.forEach(f => { rootFieldMap[f.name] = f; });
        }

        const rootTypes = userTypes.filter(t => t.name === queryTypeName || t.name === mutationTypeName);
        const objectTypes = userTypes.filter(t => t.kind === 'OBJECT' && !rootTypes.includes(t) && !t.name.endsWith('Response'));
        const inputTypes = userTypes.filter(t => t.kind === 'INPUT_OBJECT');
        const enumTypes = userTypes.filter(t => t.kind === 'ENUM');
        const scalarTypes = userTypes.filter(t => t.kind === 'SCALAR');

        if (objectTypes.length > 0) this.addSection('Object Types', objectTypes, filter, rootFieldMap);
        if (inputTypes.length > 0) this.addSection('Input Types', inputTypes, filter, rootFieldMap);
        if (enumTypes.length > 0) this.addSection('Enums', enumTypes, filter, rootFieldMap);
        if (scalarTypes.length > 0) this.addSection('Scalars', scalarTypes, filter, rootFieldMap);
    }

    addSection(title, types, filter, rootFieldMap) {
        const filteredTypes = filter
            ? types.filter(t => {
                if (t.name.toLowerCase().includes(filter)) return true;
                if (t.description && t.description.toLowerCase().includes(filter)) return true;
                if (t.fields && t.fields.some(f => f.name.toLowerCase().includes(filter))) return true;
                if (t.inputFields && t.inputFields.some(f => f.name.toLowerCase().includes(filter))) return true;
                if (t.enumValues && t.enumValues.some(v => v.name.toLowerCase().includes(filter))) return true;
                return false;
            })
            : types;

        if (filteredTypes.length === 0) return;

        const section = document.createElement('div');
        section.className = 'docs-section';

        const sectionHeader = document.createElement('h4');
        sectionHeader.className = 'docs-section-title';
        sectionHeader.textContent = title;
        section.appendChild(sectionHeader);

        filteredTypes.forEach(type => {
            const typeBlock = document.createElement('div');
            typeBlock.className = 'docs-type-block';

            const typeHeader = document.createElement('div');
            typeHeader.className = 'docs-type-header';

            const headerLeft = document.createElement('span');

            const nameSpan = document.createElement('span');
            nameSpan.className = 'docs-type-name';
            nameSpan.textContent = type.name;
            headerLeft.appendChild(nameSpan);

            headerLeft.appendChild(document.createTextNode(' '));

            const kindSpan = document.createElement('span');
            kindSpan.className = 'docs-type-kind';
            kindSpan.textContent = type.kind;
            headerLeft.appendChild(kindSpan);

            typeHeader.appendChild(headerLeft);

            if (rootFieldMap && rootFieldMap[type.name]) {
                const rootField = rootFieldMap[type.name];
                const fullBtn = document.createElement('button');
                fullBtn.className = 'docs-add-btn docs-add-btn-inline';
                fullBtn.textContent = '+ Query';
                fullBtn.title = 'Generate full query for ' + type.name;
                fullBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.options.onSetQuery) {
                        this.options.onSetQuery(this.generateFullQuery(rootField));
                    }
                });
                typeHeader.appendChild(fullBtn);
            }

            typeHeader.addEventListener('click', (e) => {
                if (e.target.closest('.docs-add-btn')) return; 
                const body = typeBlock.querySelector('.docs-type-body');
                body.classList.toggle('hidden');
            });
            typeBlock.appendChild(typeHeader);

            if (type.description) {
                const desc = document.createElement('p');
                desc.className = 'docs-type-desc';
                desc.textContent = type.description;
                typeBlock.appendChild(desc);
            }

            const body = document.createElement('div');
            body.className = 'docs-type-body hidden';

            const fields = type.fields || type.inputFields || [];
            fields.forEach(field => {
                const fieldDiv = document.createElement('div');
                fieldDiv.className = 'docs-field';

                let argsStr = '';
                if (field.args && field.args.length > 0) {
                    argsStr = '(' + field.args.map(a => `${a.name}: ${getTypeName(a.type)}`).join(', ') + ')';
                }

                const fieldInfo = document.createElement('span');

                const fNameSpan = document.createElement('span');
                fNameSpan.className = 'docs-field-name';
                fNameSpan.textContent = field.name;
                fieldInfo.appendChild(fNameSpan);

                if (argsStr) {
                    const fArgsSpan = document.createElement('span');
                    fArgsSpan.className = 'docs-field-args';
                    fArgsSpan.textContent = argsStr;
                    fieldInfo.appendChild(fArgsSpan);
                }

                fieldInfo.appendChild(document.createTextNode(': '));

                const fTypeSpan = document.createElement('span');
                fTypeSpan.className = 'docs-field-type';
                fTypeSpan.textContent = getTypeName(field.type);
                fieldInfo.appendChild(fTypeSpan);

                fieldDiv.appendChild(fieldInfo);

                if (field.description) {
                    const fdesc = document.createElement('p');
                    fdesc.className = 'docs-field-desc';
                    fdesc.textContent = field.description;
                    fieldDiv.appendChild(fdesc);
                }

                const addBtn = document.createElement('button');
                addBtn.className = 'docs-add-btn docs-add-btn-secondary docs-add-btn-sm';
                addBtn.textContent = '+ Add';
                addBtn.title = 'Add this field to the current query';
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.options.onInsertField) {
                        this.options.onInsertField(field.name);
                    }
                });
                fieldDiv.appendChild(addBtn);

                body.appendChild(fieldDiv);
            });

            if (type.enumValues) {
                type.enumValues.forEach(ev => {
                    const evDiv = document.createElement('div');
                    evDiv.className = 'docs-field';

                    const evNameSpan = document.createElement('span');
                    evNameSpan.className = 'docs-field-name';
                    evNameSpan.textContent = ev.name;
                    evDiv.appendChild(evNameSpan);

                    if (ev.description) {
                        const edesc = document.createElement('p');
                        edesc.className = 'docs-field-desc';
                        edesc.textContent = ev.description;
                        evDiv.appendChild(edesc);
                    }
                    body.appendChild(evDiv);
                });
            }

            typeBlock.appendChild(body);
            section.appendChild(typeBlock);
        });

        this.els.docsTree.appendChild(section);
    }

    getBaseTypeName(typeObj) {
        if (!typeObj) return null;
        if (typeObj.name) return typeObj.name;
        if (typeObj.ofType) return this.getBaseTypeName(typeObj.ofType);
        return null;
    }

    findTypeByName(name) {
        if (!this.schemaData) return null;
        return this.schemaData.types.find(t => t.name === name);
    }

    getScalarFields(typeName, depth) {
        if (depth > 2) return []; 
        const type = this.findTypeByName(typeName);
        if (!type || !type.fields) return [];

        const scalars = [];
        const nested = [];

        type.fields.forEach(f => {
            const baseName = this.getBaseTypeName(f.type);
            const resolvedType = this.findTypeByName(baseName);
            if (!resolvedType || resolvedType.kind === 'SCALAR' || resolvedType.kind === 'ENUM') {
                scalars.push(f.name);
            } else if (resolvedType.kind === 'OBJECT' && depth < 2) {
                const subFields = this.getScalarFields(resolvedType.name, depth + 1);
                if (subFields.length > 0) {
                    nested.push({ name: f.name, subFields });
                }
            }
        });

        return [...scalars.map(s => ({ name: s })), ...nested.map(n => ({ name: n.name, subFields: n.subFields }))];
    }

    fieldsToString(fields, indent) {
        return fields.map(f => {
            if (f.subFields) {
                return `${indent}${f.name} {\n${this.fieldsToString(f.subFields, indent + '  ')}\n${indent}}`;
            }
            return `${indent}${f.name}`;
        }).join('\n');
    }

    generateFullQuery(rootField) {
        const returnTypeName = this.getBaseTypeName(rootField.type);
        const fields = this.getScalarFields(returnTypeName, 0);

        const fieldStr = fields.length > 0
            ? ` {\n${this.fieldsToString(fields, '    ')}\n  }`
            : '';

        return `query {\n  ${rootField.name}${fieldStr}\n}`;
    }
}
