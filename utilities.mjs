import axios from 'axios'
import compareVersions from 'compare-versions'
import fs from 'fs'
import path from 'path'
import stream from 'stream'
import util from 'util'

const pipeline = util.promisify(stream.pipeline)

import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const CONFIG = require('./config.json')

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
	let filename = `${path.join(releases, tag)}`
	const response = await axios.get(url, {
		headers: { Authorization: `token ${CONFIG.token}` },
		responseType: 'stream',
	})
	await pipeline(response.data, fs.createWriteStream(filename));
}

export { getLatestLocalRelease, downloadRelease }
