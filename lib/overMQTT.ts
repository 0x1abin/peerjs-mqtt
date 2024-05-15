import { EventEmitter } from "eventemitter3";
import logger from "./logger";
import { ServerMessageType, SocketEventType } from "./enums";
import { version } from "../package.json";
import mqtt from "mqtt";
import type { MqttClient, IClientOptions } from "mqtt";


/**
 * An abstraction on top of WebSockets to provide fastest
 * possible connection for peers.
 */
export class OverMQTT extends EventEmitter {
	private _disconnected: boolean = true;
	private _isSubscribed: boolean = false;
	private _id?: string;
	private _messagesQueue: Array<object> = [];
	private _mqtt?: MqttClient;
	private _mqttOptions?: IClientOptions;
	private readonly _baseUrl: string;

	constructor(
		secure: any,
		host: string,
		port: number,
		path: string,
		private readonly pingInterval: number = 60,
		options?: IClientOptions,
	) {
		super();

		const wsProtocol = secure ? "wss://" : "ws://";

		this._baseUrl = wsProtocol + host + ":" + port + path;

		this.pingInterval = pingInterval;

		this._mqttOptions = options;
	}

	start(id: string, token: string): void {
		this._id = id;

		if (!!this._mqtt || !this._disconnected) {
			return;
		}

		this._disconnected = true;
		this._isSubscribed = false;

		logger.log("MQTT baseURL:", this._baseUrl);
		const options: IClientOptions = {
			keepalive: this.pingInterval,
			clientId: "peer@mqtt-" + version + "-" + this._id.slice(0, 8),
			protocolId: 'MQTT',
			protocolVersion: 4,
			clean: true,
			connectTimeout: 1000 * 10,
			reconnectPeriod: 1000 * 30,
			...this._mqttOptions,
		};
		logger.log("MQTT options:", options);
		this._mqtt = mqtt.connect(this._baseUrl, options);
	
		this._mqtt.on('connect', () => {
			logger.log("MQTT on connected");
			this._disconnected = false;
			this._mqtt.subscribe(this._id, (err: any) => {
				logger.log("subscribe localtopic:", this._id);
				if (!err) {
					this._isSubscribed = true;
					this._sendQueuedMessages();
					this.emit(SocketEventType.Message, { type: ServerMessageType.Open });
				}
			});
		});
		
		this._mqtt.on('message', (topic, message) => {
			// message is Buffer
			// logger.log("mqtt Recv topic:", topic, "message:", message.toString());
			if (topic == this._id) {
				this.emit(SocketEventType.Message, JSON.parse(message.toString()));
			} else {
				logger.log("Invalid server message", message);
				return;
			}
		});

		this._mqtt.on('disconnect', () => {
			logger.log("MQTT on disconnected.");
			// this._cleanup();
			this._isSubscribed = false;
			this._disconnected = true;
			this.emit(SocketEventType.Disconnected);
		});

		this._mqtt.on('close', () => {
			logger.log("MQTT on closed.");
			this.emit(SocketEventType.Close );
		});

		this._mqtt.on('error', (err: any) => {
			logger.log("MQTT on error:", err);
			this.emit(SocketEventType.Error, err);
		});

		this._mqtt.on('reconnect', () => {
			logger.log("MQTT on reconnecting...");
		});

		this._mqtt.on('offline', () => {
			logger.log("MQTT on offline.");
		});

		this._mqtt.on('end', () => {
			logger.log("MQTT on end.");
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

	send(data: any): void {
		// If we didn't get an ID yet, we can't yet send anything so we should queue
		// up these messages.
		if (!this._id || this._disconnected) {
			this._messagesQueue.push(data);
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
		
		if (!this._isSubscribed) {
			return;
		}
		
		const message = JSON.stringify(data);
		// logger.log("mqtt publish data:", message);
		this._mqtt.publish(data.dst, message);
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

	mqttc(): MqttClient | undefined {
		return this._mqtt;
	}
}
