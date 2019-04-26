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

	const getFileName = () => {
		if (info.file.parts === 1) return info.file.name;
		return `${info.file.name}.${info.part}`;
	}

	const saveMetadata = (data) => {
		info.file = JSON.parse(data);
		info.uuid = uuid();

		// If there are multiple parts, create a directory to hold them
		if (info.file.parts > 1) {
			jetpack.dir(`${uploadFolder}/${info.uuid}`);
		}
	}

	const hasMetadata = () => {
		return info.file;
	}

	ws.on('message', async data => {
		if (!hasMetadata()) {
			saveMetadata(data);
			ws.send(JSON.stringify({ ready: true }));
			console.log(`:: Ready to receieve file ${info.file.name} with ${info.file.parts} ${info.file.parts > 1 ? 'parts' : 'part'}`);
			return;
		}

		if (!info.part) info.part = 1;
		else info.part++;

		let path = `${uploadFolder}/${getFileName()}`;
		if (info.file.parts > 1) path = `${uploadFolder}/${info.uuid}/${getFileName()}`;

		const stream = fs.createWriteStream(path);
		stream.write(data);
		stream.end();

		console.log(`> Received part ${info.part} of ${info.file.parts}`);

		if (info.part < info.file.parts) {
			ws.send(JSON.stringify({ next: true }));
			return;
		}

		// TODO: The moment we finish writing to disk a part that is not the first part, we can start merging it into the original data.

		if (info.file.parts > 1) {
			for (let i = 1; i < info.file.parts + 1; i++) {
				console.log('< Merging file', i)
				try {
					const data = await jetpack.readAsync(`${uploadFolder}/${info.uuid}/${info.file.name}.${i}`, 'buffer');
					await jetpack.appendAsync(`${uploadFolder}/${info.file.name}`, data);
				} catch (error) {
					console.error(error);
				}
			}
		}
		console.log(':: Done!');
		ws.send(JSON.stringify({ done: true }));
		ws.close();
	});
});
