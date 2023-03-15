import { EventEmitter } from "eventemitter3";
import logger from "./logger";
import { SocketEventType } from "./enums";
// import { version } from "../package.json";

import { connect, MqttClient } from "mqtt";  // import connect from mqtt
// const mqtt = require('mqtt');

/**
 * An abstraction on top of WebSockets to provide fastest
 * possible connection for peers.
 */
export class MQTTSignaling extends EventEmitter {
	private _disconnected: boolean = true;
	private _id?: string;
	private _socket?: WebSocket;
	private _mqtt?: MqttClient;
	// private pingInterval?: any;
	private _localtopic?: string;
	private readonly _baseUrl: string;

	constructor(
		secure: any,
		host: string,
		port: number,
		path: string,
		private readonly pingInterval: number = 30,
	) {
		super();

		const wsProtocol = secure ? "wss://" : "ws://";

		this._baseUrl = wsProtocol + host + ":" + port + path;
		this.pingInterval = pingInterval;
	}

	start(id: string, token: string): void {
		this._id = id;
		this._localtopic = "/webrtc/signaling/" + id;
		console.log("start localtopic:", this._localtopic);

		const wsUrl = `${this._baseUrl}&id=${id}&token=${token}`;
		console.log("wsUrl:", wsUrl);
		console.log("MQTT baseURL:", this._baseUrl);

		if (!!this._socket || !this._disconnected) {
			return;
		}

		// const options = {
		// 	keepalive: this.pingInterval,
		// 	clientId: "peermq_" + this._id,
		// 	protocolId: 'MQTT',
		// 	protocolVersion: 4,
		// 	clean: true,
		// 	reconnectPeriod: 1000,
		// 	connectTimeout: 30 * 1000,
		// 	will: {
		// 	  topic: 'WillMsg',
		// 	  payload: 'Connection Closed abnormally..!',
		// 	  qos: 0,
		// 	  retain: false
		// 	},
		// 	rejectUnauthorized: false
		// };
		// let client = connect("wss://broker-cn.emqx.io:8084/mqtt");

		const options = {
			keepalive: this.pingInterval,
			clientId: "peermq_" + this._id,
			protocolId: 'MQTT',
			protocolVersion: 4,
			clean: true,
			connectTimeout: 4000,
		};
		this._mqtt = connect(this._baseUrl, options);
		this._mqtt.on('connect', function () {
			this._mqtt.subscribe(this._localtopic, function (err) {
				if (!err) {
					this._mqtt.publish(this._localtopic, 'Hello mqtt');
				}
				this._disconnected = false;
			});
		});
		
		this._mqtt.on('message', function (topic, message) {
			// message is Buffer
			console.log("topic:", topic.toString(), "message:", message.toString());
			if (topic.toString() === this._localtopic) {
				this.emit(SocketEventType.Message, JSON.parse(message.toString()));
			} else {
				logger.log("Invalid server message", message);
				return;
			}
		});

		this._mqtt.on('disconnect', function () {
			if (this._disconnected) {
				return;
			}

			logger.log("MQTT disconnected.");

			this._cleanup();
			this._disconnected = true;

			this.emit(SocketEventType.Disconnected);
		});
	}

	/** Exposed send for DC & Peer. */
	send(remoteID: String, data: any): void {
		if (this._disconnected) {
			return;
		}

		if (!data.type) {
			this.emit(SocketEventType.Error, "Invalid message");
			return;
		}

		if (!this._mqtt.connected) {
			return;
		}

		const message = JSON.stringify(data);

		this._mqtt.publish("/webrtc/signaling/" + remoteID, message);
	}

	close(): void {
		if (this._disconnected) {
			return;
		}

		this._cleanup();

		this._disconnected = true;
	}

	private _cleanup(): void {
		if (this._socket) {
			this._mqtt.end();
			this._mqtt = undefined;
		}
	}
}
