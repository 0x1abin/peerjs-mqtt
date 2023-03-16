import { EventEmitter } from "eventemitter3";
import logger from "./logger";
import { SocketEventType, ServerMessageType } from "./enums";
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
	private _mqtt?: MqttClient;
	// private pingInterval?: any;
	private _localtopic?: string;
	private readonly _baseUrl: string;
	private _messagesQueue: Array<object> = [];

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

	get localtopic(): string {
		return this._localtopic;
	}

	get mqtt(): MqttClient {
		return this._mqtt;
	}

	start(id: string, token: string): void {
		this._id = id;
		this._localtopic = "webrtc/signaling/" + id;
		logger.log("start localtopic:", this.localtopic);

		const wsUrl = `${this._baseUrl}&id=${id}&token=${token}`;
		logger.log("wsUrl:", wsUrl);
		logger.log("MQTT baseURL:", this._baseUrl);

		if (!!this._mqtt || !this._disconnected) {
			return;
		}

		const options = {
			keepalive: this.pingInterval,
			clientId: "peermq-" + this._id,
			protocolId: 'MQTT',
			protocolVersion: 4,
			clean: true,
			connectTimeout: 4000,
			reconnectPeriod: 1000,
		};
		const mqtt = connect(this._baseUrl, options);
		this._mqtt = mqtt;
	
		mqtt.on('connect', () => {
			logger.log("mqtt connected");
			mqtt.subscribe(this.localtopic, (err: any) => {
				logger.log("subscribe localtopic:", this.localtopic);
				if (!err) {
					this._disconnected = false;
					this.emit(SocketEventType.Message, { type: ServerMessageType.Open });
				}
			});
			this._sendQueuedMessages();
		});
		
		mqtt.on('message', (topic, message) => {
			// message is Buffer
			logger.log("topic:", topic.toString(), "message:", message.toString());
			if (topic == this.localtopic) {
				this.emit(SocketEventType.Message, JSON.parse(message.toString()));
			} else {
				logger.log("Invalid server message", message);
				return;
			}
		});

		mqtt.on('disconnect', () => {
			if (this._disconnected) {
				return;
			}

			logger.log("MQTT disconnected.");

			this._cleanup();
			this._disconnected = true;

			this.emit(SocketEventType.Disconnected);
		});
	}

	/** Send queued messages. */
	private _sendQueuedMessages(): void {
		//Create copy of queue and clear it,
		//because send method push the message back to queue if smth will go wrong
		const copiedQueue = [...this._messagesQueue];
		this._messagesQueue = [];
		for (const message of copiedQueue) {
			this.send(message);
		}
	}

	/** Exposed send for DC & Peer. */
	send(data: any): void {
		logger.log("send data:", data);
		// If we didn't get an ID yet, we can't yet send anything so we should queue
		// up these messages.
		if (!this._id) {
			this._messagesQueue.push(data);
			return;
		}

		if (this._disconnected) {
			return;
		}

		if (!data.type) {
			this.emit(SocketEventType.Error, " send Invalid message");
			return;
		}

		if (!data.dst) {
			logger.error("No dst");
			this.emit(SocketEventType.Error, "Not dst");
			return;
		}

		if (!this._mqtt.connected) {
			return;
		}

		const message = JSON.stringify(data);

		this._mqtt.publish("webrtc/signaling/" + data.dst, message);
	}

	close(): void {
		if (this._disconnected) {
			return;
		}

		this._cleanup();

		this._disconnected = true;
	}

	private _cleanup(): void {
		if (this._mqtt) {
			this._mqtt.end();
			this._mqtt = undefined;
		}
	}
}
