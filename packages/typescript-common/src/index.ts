import { CodegenSchemaType, CodegenGeneratorContext, CodegenGenerator, CodegenConfig, CodegenDocument, CodegenAllOfStrategy, CodegenAnyOfStrategy, CodegenOneOfStrategy, CodegenLogLevel, isCodegenOneOfSchema, isCodegenAnyOfSchema, isCodegenInterfaceSchema, isCodegenObjectSchema } from '@openapi-generator-plus/types'
import { CodegenOptionsTypeScript, DateApproach, NpmOptions, TypeScriptOptions } from './types'
import path from 'path'
import Handlebars from 'handlebars'
import { loadTemplates, emit, registerStandardHelpers } from '@openapi-generator-plus/handlebars-templates'
import { javaLikeGenerator, ConstantStyle, JavaLikeContext, options as javaLikeOptions } from '@openapi-generator-plus/java-like-generator-helper'
import { commonGenerator } from '@openapi-generator-plus/generator-common'

export { CodegenOptionsTypeScript, NpmOptions, TypeScriptOptions, DateApproach } from './types'

function escapeString(value: string | number | boolean) {
	if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
		throw new Error(`escapeString called with unsupported type: ${typeof value} (${value})`)
	}

	value = String(value)
	value = value.replace(/\\/g, '\\\\')
	value = value.replace(/'/g, '\\\'')
	value = value.replace(/\r/g, '\\r')
	value = value.replace(/\n/g, '\\n')
	return value
}

function computeCustomTemplatesPath(configPath: string | undefined, customTemplatesPath: string) {
	if (configPath) {
		return path.resolve(path.dirname(configPath), customTemplatesPath) 
	} else {
		return customTemplatesPath
	}
}

function toSafeTypeForComposing(nativeType: string): string {
	if (/[^a-zA-Z0-9_.]/.test(nativeType)) {
		return `(${nativeType})`
	} else {
		return nativeType
	}
}

export interface TypeScriptGeneratorContext extends CodegenGeneratorContext {
	loadAdditionalTemplates?: (hbs: typeof Handlebars) => Promise<void>
	additionalWatchPaths?: () => string[]
	additionalExportTemplates?: (outputPath: string, doc: CodegenDocument, hbs: typeof Handlebars, rootContext: Record<string, unknown>) => Promise<void>
	defaultNpmOptions?: (config: CodegenConfig, defaultValue: NpmOptions) => NpmOptions
	defaultTypeScriptOptions?: (config: CodegenConfig, defaultValue: TypeScriptOptions) => TypeScriptOptions
}

export function chainTypeScriptGeneratorContext(base: TypeScriptGeneratorContext, add: Partial<TypeScriptGeneratorContext>): TypeScriptGeneratorContext {
	const result: TypeScriptGeneratorContext = {
		...base,
		loadAdditionalTemplates: async function(hbs) {
			/* Load the additional first, so that earlier contexts in the chain have priority */
			if (add.loadAdditionalTemplates) {
				await add.loadAdditionalTemplates(hbs)
			}
			if (base.loadAdditionalTemplates) {
				await base.loadAdditionalTemplates(hbs)
			}
		},
		additionalWatchPaths: function() {
			const result: string[] = []
			if (base.additionalWatchPaths) {
				result.push(...base.additionalWatchPaths())
			}
			if (add.additionalWatchPaths) {
				result.push(...add.additionalWatchPaths())
			}
			return result
		},
		additionalExportTemplates: async function(outputPath, doc, hbs, rootContext) {
			if (base.additionalExportTemplates) {
				await base.additionalExportTemplates(outputPath, doc, hbs, rootContext)
			}
			if (add.additionalExportTemplates) {
				await add.additionalExportTemplates(outputPath, doc, hbs, rootContext)
			}
		},
		defaultNpmOptions: function(config, defaultOptions) {
			let result: NpmOptions = defaultOptions
			if (add.defaultNpmOptions) {
				result = add.defaultNpmOptions(config, result)
			}
			if (base.defaultNpmOptions) {
				result = base.defaultNpmOptions(config, result)
			}
			return result
		},
		defaultTypeScriptOptions: function(config, defaultOptions) {
			let result: TypeScriptOptions = defaultOptions
			if (add.defaultTypeScriptOptions) {
				result = add.defaultTypeScriptOptions(config, result)
			}
			if (base.defaultTypeScriptOptions) {
				result = base.defaultTypeScriptOptions(config, result)
			}
			return result
		},
	}
	return result
}

/* https://github.com/microsoft/TypeScript/issues/2536 */
const RESERVED_WORDS = [
	'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
	'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import',
	'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true',
	'try', 'typeof', 'var', 'void', 'while', 'with',
	'as', 'implements', 'interface', 'let', 'package', 'private', 'protected', 'public', 'static', 'yield',
	'any', 'boolean', 'constructor', 'declare', 'get', 'module', 'require', 'number', 'set', 'string', 'symbol', 'type', 'from', 'of',
]

export function options(config: CodegenConfig, context: TypeScriptGeneratorContext): CodegenOptionsTypeScript {
	const npm = config.npm
	const defaultRelativeSourceOutputPath = npm ? 'src' : ''
	
	const relativeSourceOutputPath: string = config.relativeSourceOutputPath !== undefined ? config.relativeSourceOutputPath : defaultRelativeSourceOutputPath

	const defaultDefaultNpmOptions: NpmOptions = {
		name: 'typescript-gen',
		version: '0.0.1',
		private: true,
		repository: null,
	}
	const defaultNpmOptions: NpmOptions = context.defaultNpmOptions ? context.defaultNpmOptions(config, defaultDefaultNpmOptions) : defaultDefaultNpmOptions
	const npmConfig: NpmOptions | undefined = npm ? {
		name: npm.name || defaultNpmOptions.name,
		version: npm.version || defaultNpmOptions.version,
		repository: npm.repository || defaultNpmOptions.repository,
		private: npm.private !== undefined ? npm.private : defaultNpmOptions.private,
	} : undefined

	const defaultDefaultTypeScriptOptions: TypeScriptOptions = typeof config.typescript === 'object' ? {
		target: 'ES5',
		libs: ['$target', 'DOM'],
	} : {
		target: 'ES5',
		libs: ['$target', 'DOM'],
	}
	const defaultTypeScriptOptions: TypeScriptOptions = context.defaultTypeScriptOptions ? context.defaultTypeScriptOptions(config, defaultDefaultTypeScriptOptions) : defaultDefaultTypeScriptOptions

	let typeScriptOptions: TypeScriptOptions | undefined
	if (typeof config.typescript === 'object') {
		typeScriptOptions = defaultTypeScriptOptions
		if (typeof config.typescript.target === 'string') {
			typeScriptOptions.target = config.typescript.target
		}
		if (config.typescript.libs) {
			typeScriptOptions.libs = config.typescript.libs
		}
	} else if (typeof config.typescript === 'boolean') {
		if (config.typescript) {
			typeScriptOptions = defaultTypeScriptOptions
		} else {
			typeScriptOptions = undefined
		}
	} else if (!npm) {
		/* If we haven't configured an npm package, then assume we don't want tsconfig either */
		typeScriptOptions = undefined
	} else {
		typeScriptOptions = defaultTypeScriptOptions
	}

	if (typeScriptOptions) {
		typeScriptOptions.libs = typeScriptOptions.libs.map(lib => lib === '$target' ? typeScriptOptions!.target : lib)
	}

	const dateApproach = parseDateApproach(config.dateApproach)

	const options: CodegenOptionsTypeScript = {
		...javaLikeOptions(config, createJavaLikeContext(context)),
		relativeSourceOutputPath,
		npm: npmConfig || null,
		typescript: typeScriptOptions || null,
		customTemplatesPath: config.customTemplates && computeCustomTemplatesPath(config.configPath, config.customTemplates),
		dateApproach,
	}

	return options
}

function parseDateApproach(approach: string) {
	if (!approach) {
		return DateApproach.Native
	} else if (approach === DateApproach.BlindDate) {
		return DateApproach.BlindDate
	} else if (approach === DateApproach.Native) {
		return DateApproach.Native
	} else if (approach === DateApproach.String) {
		return DateApproach.String
	} else {
		throw new Error(`Invalid dateApproach config: ${approach}`)
	}
}

function createJavaLikeContext(context: TypeScriptGeneratorContext): JavaLikeContext {
	const javaLikeContext: JavaLikeContext = {
		...context,
		reservedWords: () => RESERVED_WORDS,
		defaultConstantStyle: ConstantStyle.pascalCase,
	}
	return javaLikeContext
}


export default function createGenerator(config: CodegenConfig, context: TypeScriptGeneratorContext): Omit<CodegenGenerator, 'generatorType'> {
	const generatorOptions = options(config, context)

	const aCommonGenerator = commonGenerator(config, context)
	return {
		...context.baseGenerator(config, context),
		...aCommonGenerator,
		...javaLikeGenerator(config, createJavaLikeContext(context)),
		toLiteral: (value, options) => {
			if (value === undefined) {
				return context.generator().defaultValue(options).literalValue
			}
			if (value === null) {
				return 'null'
			}

			const { type, format, schemaType } = options

			if (schemaType === CodegenSchemaType.ENUM) {
				return `${options.nativeType.toString()}.${context.generator().toEnumMemberName(value)}`
			}

			switch (type) {
				case 'integer': {
					return `${value}`
				}
				case 'number': {
					return `${value}`
				}
				case 'string': {
					if (format === 'date') {
						switch (generatorOptions.dateApproach) {
							case DateApproach.Native:
							case DateApproach.String:
								/* Use a string as a JavaScript Date cannot represent a date properly */
								return `"${value}"`
							case DateApproach.BlindDate:
								return `toLocalDateString("${value}")`
						}
						throw new Error(`Unsupported date approach: ${generatorOptions.dateApproach}`)
					} else if (format === 'time') {
						switch (generatorOptions.dateApproach) {
							case DateApproach.Native:
							case DateApproach.String:
								/* Use a string as a JavaScript Date cannot represent a time properly */
								return `"${value}"`
							case DateApproach.BlindDate:
								return `toLocalTimeString("${value}")`
						}
						throw new Error(`Unsupported date approach: ${generatorOptions.dateApproach}`)
					} else if (format === 'date-time') {
						switch (generatorOptions.dateApproach) {
							case DateApproach.Native:
								/* The date-time format should be an ISO datetime with an offset timezone */
								return `new Date("${value}")`
							case DateApproach.BlindDate:
								return `toOffsetDateTimeString("${value}")`
							case DateApproach.String:
								return `"${value}"`
						}
						throw new Error(`Unsupported date approach: ${generatorOptions.dateApproach}`)
					} else {
						return `'${escapeString(value)}'`
					}
				}
				case 'boolean':
					return `${value}`
				case 'object':
				case 'anyOf':
				case 'oneOf':
					if (typeof value === 'string') {
						return value
					} else {
						context.log(CodegenLogLevel.WARN, `Literal is unsupported for schema type object: ${JSON.stringify(value)}`)
						return 'null'
					}
					break
				case 'file':
					throw new Error(`Cannot format literal for type ${type}`)
				case 'array': {
					const arrayValue = Array.isArray(value) ? value : [value]
					const component = options.component
					if (!component) {
						throw new Error(`toLiteral cannot format array literal without a component type: ${value}`)
					}
					return `[${arrayValue.map(v => context.generator().toLiteral(v, component)).join(', ')}]`
				}
			}

			throw new Error(`Unsupported type name: ${type}`)
		},
		toNativeType: (options) => {
			const { schemaType } = options

			/* See https://github.com/OAI/OpenAPI-Specification/blob/master/versions/2.0.md#data-types */
			switch (schemaType) {
				case CodegenSchemaType.INTEGER: {
					return new context.NativeType('number')
				}
				case CodegenSchemaType.NUMBER: {
					return new context.NativeType('number')
				}
				case CodegenSchemaType.DATE:
					switch (generatorOptions.dateApproach) {
						case DateApproach.Native:
						case DateApproach.String:
							/* We use strings for date and time as JavaScript Date can't support */
							return new context.NativeType('string')
						case DateApproach.BlindDate:
							return new context.NativeType('LocalDateString')
					}
					throw new Error(`Unsupported date approach: ${generatorOptions.dateApproach}`)
				case CodegenSchemaType.TIME:
					switch (generatorOptions.dateApproach) {
						case DateApproach.Native:
						case DateApproach.String:
							/* We use strings for date and time as JavaScript Date can't support */
							return new context.NativeType('string')
						case DateApproach.BlindDate:
							return new context.NativeType('LocalTimeString')
					}
					throw new Error(`Unsupported date approach: ${generatorOptions.dateApproach}`)
				case CodegenSchemaType.DATETIME:
					switch (generatorOptions.dateApproach) {
						case DateApproach.Native:
							/* We don't have a mapping library to convert incoming and outgoing JSON, so the rawType of dates is string */
							return new context.NativeType('Date', {
								serializedType: 'string',
							})
						case DateApproach.BlindDate:
							return new context.NativeType('OffsetDateTimeString')
						case DateApproach.String:
							return new context.NativeType('string')
					}
					throw new Error(`Unsupported date approach: ${generatorOptions.dateApproach}`)
				case CodegenSchemaType.STRING: {
					return new context.NativeType('string')
				}
				case CodegenSchemaType.BOOLEAN: {
					return new context.NativeType('boolean')
				}
				case CodegenSchemaType.FILE: {
					/* JavaScript does have a File type, but it isn't supported by JSON serialization... we say string as we have to say something, it will need to be handled in the generated code */
					return new context.NativeType('File', {
						serializedType: 'string',
					})
				}
			}

			throw new Error(`Unsupported schema type: ${schemaType}`)
		},
		toNativeObjectType: function(options) {
			const { scopedName } = options
			let modelName = 'Api'
			for (const name of scopedName) {
				modelName += `.${context.generator().toClassName(name)}`
			}
			return new context.NativeType(modelName)
		},
		toNativeArrayType: (options) => {
			const { componentNativeType } = options
			return new context.TransformingNativeType(componentNativeType, {
				default: (nativeType) => `${toSafeTypeForComposing(nativeType.componentType ? nativeType.componentType.nativeType : nativeType.nativeType)}[]`,
			})
		},
		toNativeMapType: (options) => {
			const { keyNativeType, componentNativeType } = options
			return new context.ComposingNativeType([keyNativeType, componentNativeType], {
				default: (nativeTypes) => {
					return `{ [name: ${nativeTypes[0].componentType ? nativeTypes[0].componentType.nativeType : nativeTypes[0].nativeType}]: ${nativeTypes[1].componentType ? nativeTypes[1].componentType.nativeType : nativeTypes[1].nativeType} }`
				},
			})
		},
		nativeTypeUsageTransformer: ({ nullable }) => ({
			default: function(nativeType, nativeTypeString) {
				if (nullable) {
					return `${toSafeTypeForComposing(nativeTypeString)} | null`
				}

				return nativeTypeString
			},
			/* We don't transform the concrete type as the concrete type is never null; we use it to make new objects */
			concreteType: null,
		}),
		defaultValue: (options) => {
			const { schemaType, required } = options

			if (!required) {
				return { value: null, literalValue: 'undefined' }
			}

			switch (schemaType) {
				case CodegenSchemaType.NUMBER:
					return { value: 0.0, literalValue: context.generator().toLiteral(0.0, options) }
				case CodegenSchemaType.INTEGER:
					return { value: 0, literalValue: context.generator().toLiteral(0, options) }
				case CodegenSchemaType.BOOLEAN:
					return { value: false, literalValue: 'false' }
				case CodegenSchemaType.ARRAY:
					return { value: [], literalValue: '[]' }
				case CodegenSchemaType.MAP:
					return { value: {}, literalValue: '{}' }
				default:
					return { value: null, literalValue: 'undefined' }
			}
		},
		initialValue: (options) => {
			const { schemaType, required } = options

			if (!required) {
				return null
			}

			switch (schemaType) {
				case CodegenSchemaType.NUMBER:
					return { value: 0.0, literalValue: context.generator().toLiteral(0.0, options) }
				case CodegenSchemaType.INTEGER:
					return { value: 0, literalValue: context.generator().toLiteral(0, options) }
				case CodegenSchemaType.BOOLEAN:
					return { value: false, literalValue: 'false' }
				case CodegenSchemaType.ARRAY:
					return { value: [], literalValue: '[]' }
				case CodegenSchemaType.MAP:
					return { value: {}, literalValue: '{}' }
				default:
					return { value: null, literalValue: 'undefined' }
			}
		},
		operationGroupingStrategy: () => {
			return context.operationGroupingStrategies.addToGroupsByTagOrPath
		},
		allOfStrategy: () => CodegenAllOfStrategy.OBJECT,
		anyOfStrategy: () => CodegenAnyOfStrategy.NATIVE,
		oneOfStrategy: () => CodegenOneOfStrategy.NATIVE,
		supportsInheritance: () => true,
		supportsMultipleInheritance: () => true, /* As we use interfaces not classes */
		nativeOneOfCanBeScope: () => true,

		watchPaths: () => {
			const result = [path.resolve(__dirname, '..', 'templates')]
			if (context.additionalWatchPaths) {
				result.push(...context.additionalWatchPaths())
			}
			if (config.customTemplates) {
				result.push(computeCustomTemplatesPath(config.configPath, config.customTemplates))
			}
			return result
		},

		cleanPathPatterns: () => undefined,

		templateRootContext: () => {
			return {
				...aCommonGenerator.templateRootContext(),
				...generatorOptions,
			}
		},

		exportTemplates: async(outputPath, doc) => {
			const hbs = Handlebars.create()

			registerStandardHelpers(hbs, context)

			await loadTemplates(path.resolve(__dirname, '..', 'templates'), hbs)
			if (context.loadAdditionalTemplates) {
				await context.loadAdditionalTemplates(hbs)
			}

			if (generatorOptions.customTemplatesPath) {
				await loadTemplates(generatorOptions.customTemplatesPath, hbs)
			}

			const rootContext = context.generator().templateRootContext()

			if (generatorOptions.npm) {
				await emit('package', path.join(outputPath, 'package.json'), { ...rootContext, ...generatorOptions.npm }, true, hbs)
				await emit('gitignore', path.join(outputPath, '.gitignore'), { ...rootContext, ...doc }, true, hbs)
			}
			
			if (generatorOptions.typescript) {
				await emit('tsconfig', path.join(outputPath, 'tsconfig.json'), { ...rootContext, ...generatorOptions.typescript }, true, hbs)
			}
	
			if (context.additionalExportTemplates) {
				await context.additionalExportTemplates(outputPath, doc, hbs, rootContext)
			}
		},

		postProcessSchema: (schema) => {
			/* We don't have access to the schema when we create the native type, so we post-process to change the native type
			   to represent the disjunctions that we support.
			 */
			if (isCodegenOneOfSchema(schema) || isCodegenAnyOfSchema(schema)) {
				schema.nativeType.nativeType = schema.composes.map(s => s.nativeType.parentType).join(' | ')
			} else if (isCodegenObjectSchema(schema) && schema.discriminator && schema.children) {
				schema.nativeType.nativeType = schema.children.map(s => s.nativeType.parentType).join(' | ')
			} else if (isCodegenInterfaceSchema(schema) && schema.discriminator && schema.implementors) {
				schema.nativeType.nativeType = schema.implementors.map(s => s.nativeType.parentType).join(' | ')
			}
		},
	}
}
