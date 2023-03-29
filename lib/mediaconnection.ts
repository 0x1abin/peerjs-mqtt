import { util } from "./util";
import logger from "./logger";
import { Negotiator } from "./negotiator";
import { ConnectionType, ServerMessageType } from "./enums";
import { Peer } from "./peer";
import { BaseConnection } from "./baseconnection";
import { ServerMessage } from "./servermessage";
import type { AnswerOption } from "./optionInterfaces";

type MediaConnectionEvents = {
	/**
	 * Emitted when a connection to the PeerServer is established.
	 */
	stream: (stream: MediaStream) => void;
};

/**
 * Wraps the streaming interface between two Peers.
 */
export class MediaConnection extends BaseConnection<MediaConnectionEvents> {
	private static readonly ID_PREFIX = "mc_";

	private _negotiator: Negotiator<MediaConnectionEvents, MediaConnection>;
	private _localStream: MediaStream;
	private _remoteStream: MediaStream;
	private _dc: RTCDataChannel;

	get type() {
		return ConnectionType.Media;
	}

	get localStream(): MediaStream {
		return this._localStream;
	}
	get remoteStream(): MediaStream {
		return this._remoteStream;
	}

	get dataChannel(): RTCDataChannel {
		return this._dc;
	}

	constructor(peerId: string, provider: Peer, options: any) {
		super(peerId, provider, options);

		this._localStream = this.options._stream;
		this.connectionId =
			this.options.connectionId ||
			MediaConnection.ID_PREFIX + util.randomToken();

		this._negotiator = new Negotiator(this);

		if (this._localStream) {
			this._negotiator.startConnection({
				_stream: this._localStream,
				originator: true,
			});
		}
	}

	/** Called by the Negotiator when the DataChannel is ready. */
	initialize(dc: RTCDataChannel): void {
		this._dc = dc;
		this._configureDataChannel();
	}

	private _configureDataChannel(): void {
		if (!util.supports.binaryBlob || util.supports.reliable) {
			this.dataChannel.binaryType = "arraybuffer";
		}

		this.dataChannel.onopen = () => {
			logger.log(`DC#${this.connectionId} dc connection success`);
		};

		this.dataChannel.onmessage = (e) => {
			logger.log(`DC#${this.connectionId} dc onmessage:`, e.data);
		};

		this.dataChannel.onclose = () => {
			logger.log(`DC#${this.connectionId} dc closed for:`, this.peer);
			this.close();
		};
	}

	addStream(remoteStream) {
		logger.log("Receiving stream", remoteStream);

		this._remoteStream = remoteStream;
		super.emit("stream", remoteStream); // Should we call this `open`?
	}

	handleMessage(message: ServerMessage): void {
		const type = message.type;
		const payload = message.payload;

		switch (message.type) {
			case ServerMessageType.Answer:
				// Forward to negotiator
				this._negotiator.handleSDP(type, payload.sdp);
				this._open = true;
				break;
			case ServerMessageType.Candidate:
				this._negotiator.handleCandidate(payload.candidate);
				break;
			default:
				logger.warn(`Unrecognized message type:${type} from peer:${this.peer}`);
				break;
		}
	}

	answer(stream?: MediaStream, options: AnswerOption = {}): void {
		if (this._localStream) {
			logger.warn(
				"Local stream already exists on this MediaConnection. Are you answering a call twice?",
			);
			return;
		}

		this._localStream = stream;

		if (options && options.sdpTransform) {
			this.options.sdpTransform = options.sdpTransform;
		}

		this._negotiator.startConnection({
			...this.options._payload,
			_stream: stream,
		});
		// Retrieve lost messages stored because PeerConnection not set up.
		const messages = this.provider._getMessages(this.connectionId);

		for (let message of messages) {
			this.handleMessage(message);
		}

		this._open = true;
	}

	replaceStream(stream: MediaStream): void {
		if (!this._negotiator) {
			logger.warn(
				"Replacing Stream not supported for this browser yet. You need to pass a new stream to the PeerConnection when calling answer.",
			);
			return;
		}
		this._negotiator.replaceStream(stream);
	}

	/**
	 * Exposed functionality for users.
	 */

	/** Allows user to close connection. */
	close(): void {
		if (this._negotiator) {
			this._negotiator.cleanup();
			this._negotiator = null;
		}

		this._localStream = null;
		this._remoteStream = null;

		if (this.provider) {
			this.provider._removeConnection(this);

			this.provider = null;
		}

		if (this.options && this.options._stream) {
			this.options._stream = null;
		}

		if (!this.open) {
			return;
		}

		this._open = false;

		super.emit("close");
	}
}
