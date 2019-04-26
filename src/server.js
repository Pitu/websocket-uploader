const WebSocket = require('ws');
const uuid = require('uuidv4');
const fs = require("fs");
const jetpack = require('fs-jetpack');

const uploadFolder = 'uploads';

const wss = new WebSocket.Server({
	port: 6999,
	maxPayload: 9.9e+7 // 99mb
});

wss.on('connection', function connection(ws) {
	const info = {};
	const mergeQueue = [];
	let isQueueRunning = false;

	const getFileName = () => {
		return `${info.file.name}.${info.part}`;
	}

	const saveMetadata = (data) => {
		info.file = JSON.parse(data);
		info.uuid = uuid();
		jetpack.dir(`${uploadFolder}/${info.uuid}`);
	}

	const hasMetadata = () => {
		return info.file;
	}

	const sendReady = () => {
		ws.send(JSON.stringify({ ready: true }));
		console.log(`:: Ready to receieve file ${info.file.name} with ${info.file.parts} ${info.file.parts > 1 ? 'parts' : 'part'}`);
	}

	const needsNextPart = () => {
		if (info.part < info.file.parts) {
			ws.send(JSON.stringify({ next: true }));
			return true;
		}
		return false;
	}

	const addToMergeQueue = (part) => {
		mergeQueue.push(part);
		if (!isQueueRunning) {
			isQueueRunning = true;
			mergeNextPart();
		}
	}

	const mergeNextPart = () => {
		if (!mergeQueue.length) {
			isQueueRunning = false;
			return;
		}
		mergePart(mergeQueue[0]);
		// if (!isQueueBusy) mergePart(mergeQueue[0]);
	}

	const mergePart = async part => {
		console.log('< Merging part', part)
		const data = await jetpack.readAsync(`${uploadFolder}/${info.uuid}/${info.file.name}.${part}`, 'buffer');
		await jetpack.appendAsync(`${uploadFolder}/${info.file.name}`, data);
		mergeQueue.splice(0, 1);
		mergeNextPart();

		/*
			There's a race condition I believe somewhere around the isQueueRunning assignment.
			From time to time, I'm getting:
				(node:18800) UnhandledPromiseRejectionWarning: Error: EBUSY: resource busy or locked
				pointing to the appendAsync function.
			Gotta look into it a bit more to find a proper way to queue items for merging, otherwise
			doing it sequentially takes a lot of time for big files.
		*/

		// await jetpack.removeAsync(`${uploadFolder}/${info.uuid}/${info.file.name}.${part}`);
	}

	const deleteTempFolder = async () => {
		// await jetpack.removeAsync(`${uploadFolder}/${info.uuid}`);
	}

	const closeConnection = () => {
		console.log(':: Done!');

		ws.send(JSON.stringify({ done: true }));
		ws.close();
	}

	ws.on('message', async data => {
		if (!hasMetadata()) {
			saveMetadata(data);
			sendReady();
			return;
		}

		if (!info.part) info.part = 1;
		else info.part++;

		const path = `${uploadFolder}/${info.uuid}/${getFileName()}`;
		const stream = fs.createWriteStream(path);
		stream.write(data);
		stream.end();

		console.log(`> Received part ${info.part} of ${info.file.parts}`);

		addToMergeQueue(info.part);
		if (needsNextPart()) return;

		deleteTempFolder();
		closeConnection();
	});
});
