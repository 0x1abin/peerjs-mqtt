import { EventEmitter } from "eventemitter3";
import logger from "./logger";
import { SocketEventType, ServerMessageType } from "./enums";
// import { connect, MqttClient } from "mqtt";  // import connect from mqtt
import { connect, MqttClient } from "mqtt/dist/mqtt.min";  // import connect from mqtt
// import * as mqtt from 'mqtt/dist/mqtt.min'
// import { crypto } from "crypto-js";
// const mqtt = require('mqtt');

/**
 * An abstraction on top of WebSockets to provide fastest
 * possible connection for peers.
 */
export class MQTTSignaling extends EventEmitter {
	private _disconnected: boolean = true;
	private _id?: string;
	// private _key?: CryptoKey;
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

	start(id: string): void {
        if (!!this._mqtt || !this._disconnected) {
            return;
		}

        // 63dfef03-9bfe-420d-941d-066619d76db1
		this._id = id;
		this._localtopic = id.slice(0, 20);
		// this._importSecretKey(new TextEncoder().encode(id.slice(20))).then((key) => {

            // this._key = key;
            logger.log("MQTT baseURL:", this._baseUrl);
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
                    // const plaintext = this._decryptMessage(this._key, message);
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
        // });
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

    // private _importSecretKey(rawKey: Uint8Array) {
    //     return window.crypto.subtle.importKey("raw", rawKey, "AES-GCM", true, [
    //       "encrypt",
    //       "decrypt",
    //     ]);
    //   }

	// private _encryptMessage(iv, key, data) {
	// 	// The iv must never be reused with a given key.
	// 	// const iv = window.crypto.getRandomValues(new Uint8Array(12));
	// 	return window.crypto.subtle.encrypt(
	// 		{ name: "AES-GCM", iv: iv },
	// 		key,
	// 		data
	// 	);
	// }

    // private _decryptMessage(key, data): string {
    //     if (data.length < 12) {
    //         throw new Error("Invalid data");
    //     }
    //     const iv = data.slice(0, 12);
    //     const ciphertext = data.slice(12);
    //     const plaintext = window.crypto.subtle.decrypt(
    //         { name: "AES-GCM", iv: iv },
    //         key,
    //         ciphertext
    //     );
    //     return plaintext.toString();
    // }

	/** Exposed send for DC & Peer. */
	send(data: any): void {
		logger.log("send data:", data);
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

		if (!this._mqtt.connected) {
			return;
		}

		const message = JSON.stringify(data);
        // this._encryptMessage
		this._mqtt.publish(data.dst.slice(0, 20), message);
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
