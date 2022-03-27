import axios from 'axios'
import compression from 'compression'
import express from 'express'
import fs from 'fs'
import http from 'http'
import morgan from 'morgan'
import os from 'os'
import path from 'path'

import { QueueManager } from './queue.mjs'
import { handleRepoCommand, RepoCommand } from './consumer.mjs'
import { getLatestLocalRelease } from './utilities.mjs'

// we can't use ESModule imports to get JSON content, so we use
// good ol' `require`
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const CONFIG = require('./config.json')

// validate CONFIG format and contents
const validate = async () => {
	const requiredKeys = ['token', 'repositories']

	// verify required keys are present
	let keys = Object.keys(CONFIG)
	if (!requiredKeys.every(k => keys.includes(k))) {
		console.error(`Missing at least one required option in config.json: ${requiredKeys.join(', ')}`)
		process.exit(1)
	}

	// make sure token is valid
	if (CONFIG.token.length === 0) {
		console.error('Invalid GitHub access token in config.json, did you replace it with your account\'s token?')
	}

	// fill optional keys with defaults
	if (!CONFIG.releases) {
		CONFIG.releases = './releases'
	}
	if (!CONFIG.prefix) {
		CONFIG.prefix = path.join(os.homedir(), 'code')
	}

	// verify that install target is available
	try {
		await fs.promises.access(CONFIG.prefix)
	} catch (e) {
		await fs.promises.mkdir(CONFIG.prefix, { recursive: true })
	}
	try {
		await fs.promises.access(path.join(CONFIG.prefix, '.env'))
	} catch (e) {
		await fs.promises.mkdir(path.join(CONFIG.prefix, '.env'), { recursive: true })
	}

	// verify that each repository CONFIG.repositories is accessible
	for (let [index, repository] of CONFIG.repositories.entries()) {
		if (repository.endsWith('/')) {
			repository = repository.replace(/\/*$/, '').replace(/^\/*/, '')
			CONFIG.repositories[index] = repository
		}

		console.log(`Checking ${repository}...`)
		let response
		try {
			response = await axios.get(`https://api.github.com/repos/${repository}`, {
				headers: { Authorization: `token ${CONFIG.token}` }
			})
		} catch (e) {
			console.error(`Could not find repository '${repository}', is it available with the provided GitHub access token?`)
			process.exit(1)
		}

		if (response.status !== 200) {
			console.error(`Could not find repository '${repository}', is it available with the provided GitHub access token?`)
			process.exit(1)
		}
	}

	// verify CONFIG.releases is available
	console.log(`Creating release file structure...`)
	try {
		await fs.promises.access(CONFIG.releases)
		for (let repository of CONFIG.repositories) {
			await fs.promises.access(path.join(CONFIG.releases, repository))
		}
	} catch (e) {
		try {
			await fs.promises.mkdir(CONFIG.releases, { recursive: true })
			for (let repository of CONFIG.repositories) {
				await fs.promises.mkdir(path.join(CONFIG.releases, repository), { recursive: true})
			}
		} catch (e) {
			console.error(`Could not create release directory '${CONFIG.releases}'`)
			process.exit(1)
		}
	}
}

// validate app configuration
await validate()

// start queue service
const qm = new QueueManager()
await qm.restore()
for (let repository of CONFIG.repositories) {
	if (!Object.keys(qm.queues).includes(repository)) {
		qm.createQueue(repository)
	}
	qm.createConsumer(repository, handleRepoCommand)
}

// create app
require('dotenv').config()
const app = express()
const port = process.env.PORT || 42369
app.set('json spaces', 2)
app.use(compression())
app.use(
	morgan((tokens, req, res) => {
		return [
			tokens.date(req, res, 'iso'),
			tokens.method(req, res),
			tokens.url(req, res),
			tokens.status(req, res),
			`- ${tokens['response-time'](req, res)}ms`
		].join(' ')
	})
)

// see what repositories are available for sync'ing
app.get('/', async (req, res, next) => {
	res.status(200).json(CONFIG.repositories)
})

// get app status
app.get('/status', async (req, res, next) => {
	let results = []
	let statuses = {
		DONE: 'idle',
		ERROR: 'error',
		CHECK: 'checking for updates...',
		TUG: 'pulling updates...',
		UNPACK: 'installing updates...',
		LINK: 'installing updates...'
	}

	for (let repository of CONFIG.repositories) {
		let installedFile = path.resolve(path.join(CONFIG.releases, repository, '.installed'))
		let version = ''
		try {
			await fs.promises.access(installedFile)
			let fileContents = await fs.promises.readFile(installedFile)
			version = fileContents.toString()
		} catch (e) {}

		let status = 'initializing...'
		try {
			status = statuses[qm.queues[repository].consumed[qm.queues[repository].consumed.length - 1].data.command]
		} catch (e) {}

		let repo = { name: repository, status, version }
		results.push(repo)
	}
	res.status(200).json(results)
})

// tug (pull) new release for specific repository
app.get('/:user/:repo', async (req, res, next) => {
	// when this route is hit, it means a new release has been published
	// via GitHub webhooks

	let repository = `${req.params.user}/${req.params.repo}`

	// make sure we can sync the desired repository
	if (!CONFIG.repositories.includes(repository)) {
		console.error(`Unknown repository: ${repository}`)
		res.status(404).json('error')
		return
	}

	// if successful, produce CHECK command
	await qm.produce(repository, new RepoCommand('CHECK', repository))
	res.status(200).json('success')
})

// start app
if (process.env.NODE_ENV === 'prod') {
	const httpServer = http.createServer(app)
	httpServer.listen(port, () => {
		console.log(`HTTP server running on ${port}`)
	})
} else {
	app.listen(port, '0.0.0.0', () => {
		console.log(`Server running on http://0.0.0.0:${port}`)
	})
}
