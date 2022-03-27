import fs from 'fs'
import path from 'path'

class QueueManager {
	constructor(source='./queue', backup=true) {

		// QueueManager is a singleton
		if (QueueManager._instance) {
			return QueueManager._instance
		}
		QueueManager._instance = this

		this.queues = {}
		this.source = source
		this.consumers = []

		// check that source exists
		try {
			fs.access(this.source)
		} catch (e) {
			fs.mkdirSync(this.source, { recursive: true })
		}

		// register backup every minute
		if (backup) {
			setInterval(async () => {
				await this.backup()
			}, 60000)
		}
	}

	async createQueue(name) {
		this.queues[name] = new Queue()
	}

	async createConsumer(queueName, consumerFunction, pollPeriod=10) {
		let consumer = setInterval(async () => {
			await consumerFunction(this.queues[queueName])
		}, pollPeriod * 1000)
		this.consumers.push(consumer)
	}

	async produce(name, data) {
		await this.queues[name].produce(data)
	}

	async consume(name) {
		return this.queues[name].consume()
	}

	async restore() {
		console.log('Restoring queues...')
		let filename = path.join(this.source, 'queue.json')

		// if there isn't a queue backup, return
		try {
			await fs.promises.access(filename)
		} catch (e) {
			return
		}

		// attempt to restore queues from local backup
		try {
			let data = JSON.parse(await fs.promises.readFile(filename))
			for (let queueName in data) {
				let unconsumed = []
				let consumed = []
				let max = data[queueName].max
				for (let item of data[queueName].unconsumed) {
					let qi = new QueueItem(item.data)
					qi.produced = item.produced
					unconsumed.push(qi)
				}
				for (let item of data[queueName].consumed) {
					let qi = new QueueItem(item.data)
					qi.produced = item.produced
					qi.consumed = item.consumed
					consumed.push(qi)
				}
				this.queues[queueName] = new Queue()
				this.queues[queueName].unconsumed = unconsumed
				this.queues[queueName].consumed = consumed
				this.queues[queueName].max = max
			}
			this.queues
		} catch (e) {
			console.error(e)
			process.exit(1)
		}
	}

	async backup() {
		console.log('Backing up queues...')
		await fs.promises.writeFile(path.join(this.source, 'queue.json'), JSON.stringify(this.queues))
	}
}

class Queue {
	constructor(max=100) {
		this.unconsumed = []
		this.consumed = []
		this.max = max
	}

	async consume() {
		let qi = this.unconsumed.shift()
		let data = await qi.consume()
		this.consumed.push(qi)
		if (this.consumed.length > this.max) {
			this.consumed.shift()
		}
		return data
	}

	async produce(data) {
		let qi = new QueueItem(data)
		this.unconsumed.push(qi)
	}
}

class QueueItem {
	constructor(data) {
		this.data = data
		this.produced = Date.now()
		this.consumed = null
	}

	async consume() {
		this.consumed = Date.now()
		return this.data
	}
}

export { QueueManager }
