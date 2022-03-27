import axios from 'axios'
import compareVersions from 'compare-versions'
import compression from 'compression'
import express from 'express'
import fs from 'fs'
import http from 'http'
// import { Kafka } from 'kafkajs'
import morgan from 'morgan'
import path from 'path'
import util from 'util'

// Node.js doesn't promisify this stuff for us...
const mkdirPromise = util.promisify(fs.mkdir)

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
			console.error(e)
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
			await mkdirPromise(CONFIG.releases, { recursive: true })
			for (let repository of CONFIG.repositories) {
				await mkdirPromise(path.join(CONFIG.releases, repository), { recursive: true})
			}
		} catch (e) {
			console.error(`Could not create release directory '${CONFIG.releases}'`)
			process.exit(1)
		}
	}
}

// get the latest local release from CONFIG.releases
const getLatestLocalRelease = async (releases) => {
	let latestRelease
	for (let release of releases) {
		if (latestRelease === undefined) {
			latestRelease = release
		} else {
			if (compareVersions(release, latestRelease) === 1) {
				latestRelease = release
			}
		}
	}
	return latestRelease
}

// download a release from GitHub
const downloadRelease = async (tag, url, releases) => {
	let filename = path.join(releases, tag)
	let response = await axios.get(url, {
		headers: { Authorization: `token ${CONFIG.token}` },
		responseType: 'stream'
	})
	response.data.pipe(fs.createWriteStream(filename))
}

// validate app configuration
await validate()

// start Kafka
// const kafka = new Kafka({
// 	clientId: 'my-app',
// 	brokers: ['kafka1:9092', 'kafka2:9092'],
// })

// create app
require('dotenv').config()
const app = express()
const port = process.env.PORT || 42369
app.set('json spaces', 2)
app.use(compression())
app.use(
	morgan((tokens, req, res) => {
		return [
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

	// get latest release
	let response
	try {
		response = await axios.get(`https://api.github.com/repos/${repository}/releases/latest`, {
			headers: { Authorization: `token ${CONFIG.token}` }
		})

		// we return immediately regardless of whether we can download the release, because
		// we need to respond to the GitHub webhook promptly; then, we can attempt download
		// asynchronously
		res.status(200).json('success')
	} catch (e) {
		res.status(500).json('error')
		return
	}

	// determine latest local release that's already been downloaded
	let data = response.data
	let releasePath = path.join(CONFIG.releases, repository)
	let localReleases = await fs.promises.readdir(releasePath).filter(r => r !== '.latest')
	let latestRelease
	try {
		latestRelease = await getLatestLocalRelease(localReleases)
	} catch (e) {
		console.error(`Could not determine most recent local release from: ${localReleases.join(', ')}`)
		return
	}

	// attempt to upgrade local to latest remote release
	if (!localReleases.includes(data.tag_name)) {
		try {
			if (latestRelease === undefined || compareVersions(data.tag_name, latestRelease) === 1) {
				console.log(`Found new release ${data.tag_name}, downloading...`)
				try {
					await downloadRelease(data.tag_name, data.tarball_url, releasePath)
				} catch (e) {
					console.error('Error while downloading release')
					return
				}
				console.log(`Downloaded release ${data.tag_name} to ${path.resolve(releasePath)}`)
			} else {
				console.log(`Found new release ${data.tag_name} (remote), but it is superseded by ${latestRelease} (local)`)
			}
		} catch (e) {
			console.error(`Could not determine latest release between '${latestRelease}' (local) and '${data.tag_name}' (remote)`)
			return
		}
	} else {
		console.log(`Release ${data.tag_name} already downloaded, skipping...`)
	}
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
