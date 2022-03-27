import axios from 'axios'
import compareVersions from 'compare-versions'
import { exec } from 'child_process'
import fs from 'fs'
import fse from 'fs-extra'
import path from 'path'
import { QueueManager } from './queue.mjs'
import util from 'util'
import { getLatestLocalRelease, downloadRelease } from './utilities.mjs'

const execPromise = util.promisify(exec)

import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const CONFIG = require('./config.json')

const handleRepoCommand = async (queue) => {
	while (queue.unconsumed.length > 0) {
		let data = await queue.consume()

		switch (data.command) {
			case 'CHECK':
				console.log(`Handling CHECK for ${data.repository}`)
				await handleCheck(data.repository)
				break
			case 'TUG':
				console.log(`Handling TUG for ${data.repository}`)
				await handleTug(data.repository, data.details)
				break
			case 'UNPACK':
				console.log(`Handling UNPACK for ${data.repository}`)
				await handleUnpack(data.repository, data.details)
				break
			case 'LINK':
				console.log(`Handling LINK for ${data.repository}`)
				await handleLink(data.repository, data.details)
				break
			case 'DONE':
				console.log(`Handling DONE for ${data.repository}`)
				await handleDone(data.repository)
				break
			case 'ERROR':
				console.log(`Handling ERROR for ${data.repository}`)
				await handleError(data.repository)
				break
			default:
				throw new Error(`Unsupported repository command ${data.command}`)
		}
	}
}

const handleCheck = async (repository) => {
	// access queue singleton
	let qm = new QueueManager()

	// get latest release
	let response
	try {
		response = await axios.get(`https://api.github.com/repos/${repository}/releases/latest`, {
			headers: { Authorization: `token ${CONFIG.token}` }
		})
		await qm.produce(repository, new RepoCommand('TUG', repository, { tag: response.data.tag_name }))
	} catch (e) {
		await qm.produce(repository, new RepoCommand('ERROR', repository))
	}
}

const handleTug = async (repository, details) => {
	// access queue singleton
	let qm = new QueueManager()

	// determine latest local release that's already been downloaded
	let tag = details.tag
	let releasePath = path.join(CONFIG.releases, repository)
	let localReleases = await fs.promises.readdir(releasePath)
	localReleases = localReleases.filter(r => r !== '.latest')
	let latestRelease
	try {
		latestRelease = await getLatestLocalRelease(localReleases)
	} catch (e) {
		console.error(`Could not determine most recent local release from: ${localReleases.join(', ')}`)
		await qm.produce(repository, new RepoCommand('ERROR', repository))
		return
	}

	// attempt to upgrade local to latest remote release
	if (!localReleases.includes(tag)) {
		try {
			if (latestRelease === undefined || compareVersions(tag, latestRelease) === 1) {
				console.log(`Found new release ${tag}, downloading...`)
				try {
					await downloadRelease(tag, `https://github.com/${repository}/archive/${tag}.tar.gz`, releasePath)
				} catch (e) {
					console.error('Error while downloading release')
					await qm.produce(repository, new RepoCommand('ERROR', repository))
					return
				}
				console.log(`Downloaded release ${tag} to ${path.resolve(releasePath)}`)
				await qm.produce(repository, new RepoCommand('UNPACK', repository, { release: tag }))
			} else {
				console.log(`Found new release ${tag} (remote), but it is superseded by ${latestRelease} (local)`)
				await qm.produce(repository, new RepoCommand('DONE', repository))
			}
		} catch (e) {
			console.error(`Could not determine latest release between '${latestRelease}' (local) and '${tag}' (remote)`)
			await qm.produce(repository, new RepoCommand('ERROR', repository))
		}
	} else {
		console.log(`Release ${tag} already downloaded, skipping...`)
		await qm.produce(repository, new RepoCommand('DONE', repository))
	}
}

const handleUnpack = async (repository, details) => {
	// access queue singleton
	let qm = new QueueManager()

	try {
		let sourceDir = path.resolve(path.join(CONFIG.releases, repository))
		let tarball = `${path.resolve(path.join(CONFIG.releases, repository, details.release))}`
		let targetDir = path.resolve(path.join(CONFIG.releases, repository, '.latest'))

		await fs.promises.mkdir(targetDir, { recursive: true })
		await execPromise(`tar -xzf ${tarball} -C ${targetDir} --strip-components 1`)

		await qm.produce(repository, new RepoCommand('LINK', repository, details))
	} catch (e) {
		console.error(e)
		await qm.produce(repository, new RepoCommand('ERROR', repository))
	}
}

const handleLink = async (repository, details) => {
	// access queue singleton
	let qm = new QueueManager()

	try {
		let source = path.resolve(path.join(CONFIG.releases, repository, '.latest'))
		let destination = path.resolve(path.join(CONFIG.prefix, repository))
		let envBackupDir = path.resolve(path.join(CONFIG.prefix, '.env'))
		let envDestFile = path.resolve(path.join(destination, '.env'))
		let envBackupFile = path.resolve(path.join(envBackupDir, '.env'))

		// we first need to backup any environment files
		let backedUpEnv = false
		try {
			await fs.promises.access(envDestFile)
			await fse.copy(envDestFile, envBackupFile, { overwrite: true })
			backedUpEnv = true
		} catch (e) {}

		// update repository contents
		await fse.emptyDir(destination)
		await fse.copy(source, destination)

		// restore environment files
		if (backedUpEnv) {
			await fse.copy(envBackupFile, envDestFile, { overwrite: true })
		}

		// if deployed via PM2, reboot
		if (CONFIG.reboot === true) {
			await execPromise(`pm2 restart ${repository}`)
		}

		// update installed file
		let installedFile = path.resolve(path.join(CONFIG.releases, repository, '.installed'))
		await fs.promises.writeFile(installedFile, details.release)

		await qm.produce(repository, new RepoCommand('DONE', repository))
	} catch (e) {
		console.error(e)
		await qm.produce(repository, new RepoCommand('ERROR', repository))
	}
}

const handleDone = async (repository) => {}

const handleError = async (repository) => {}

class RepoCommand {
	constructor(command, repository, details={}) {
		this.command = command
		this.repository = repository
		this.details = details
	}
}

export { handleRepoCommand, RepoCommand }
