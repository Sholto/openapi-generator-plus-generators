import { testGenerate } from '@openapi-generator-plus/generator-common/dist/testing'
import { promises as fs } from 'fs'
import path from 'path'
import { DEFAULT_CONFIG, prepare } from './common'

test('accept header derived from response content types', async() => {
	const result = await prepare('accept-header.yml', {
		...DEFAULT_CONFIG,
	})

	let apiContent = ''
	await testGenerate(result, {
		testName: 'accept-header',
		postProcess: async(basePath) => {
			apiContent = await fs.readFile(path.join(basePath, 'src', 'api', 'things.ts'), 'utf-8')
		},
	})

	expect(apiContent).toContain("localVarHeaderParameter.set('Accept', 'application/json, application/xml')")
}, 20000)
