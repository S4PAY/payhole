import { createSocket } from "node:dgram";
import { connect } from "node:net";
import { isTruncated, MAX_MESSAGE_BYTES, messageId } from "./dnsWire.js";

export interface DnsForwarderOptions {
  host: string;
  port: number;
  /** Per attempt; a truncated UDP answer costs a second attempt over TCP. */
  timeoutMs?: number;
}

/** Hands wire-format queries to the local resolver over UDP and repeats over TCP when the answer was truncated. */
export class DnsForwarder {
  private readonly timeoutMs: number;

  constructor(private readonly options: DnsForwarderOptions) {
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  get target(): string {
    return `${this.options.host}:${this.options.port}`;
  }

  async query(message: Buffer): Promise<Buffer> {
    const answer = await this.udp(message);
    return isTruncated(answer) ? this.tcp(message) : answer;
  }

  udp(message: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const socket = createSocket(this.options.host.includes(":") ? "udp6" : "udp4");
      const id = messageId(message);
      const timer = setTimeout(() => finish(new Error(`no UDP answer from ${this.target} within ${this.timeoutMs} ms`)), this.timeoutMs);
      const finish = (error: Error | null, answer?: Buffer): void => {
        clearTimeout(timer);
        socket.close();
        if (error) reject(error);
        else resolve(answer!);
      };
      socket.once("error", (error) => finish(error));
      socket.on("message", (answer) => {
        if (answer.length >= 2 && messageId(answer) === id) finish(null, answer);
      });
      socket.send(message, this.options.port, this.options.host, (error) => {
        if (error) finish(error);
      });
    });
  }

  tcp(message: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.options.host, port: this.options.port });
      const chunks: Buffer[] = [];
      let received = 0;
      let expected = -1;
      let done = false;
      const finish = (error: Error | null, answer?: Buffer): void => {
        if (done) return;
        done = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(answer!);
      };
      socket.setTimeout(this.timeoutMs, () => finish(new Error(`no TCP answer from ${this.target} within ${this.timeoutMs} ms`)));
      socket.once("error", (error) => finish(error));
      socket.once("close", () => finish(new Error(`${this.target} closed the connection before answering`)));
      socket.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        received += chunk.length;
        const all = Buffer.concat(chunks);
        if (expected < 0 && all.length >= 2) {
          expected = all.readUInt16BE(0);
          if (expected > MAX_MESSAGE_BYTES) return finish(new Error(`${this.target} answered with ${expected} bytes, more than ${MAX_MESSAGE_BYTES}`));
        }
        if (expected >= 0 && received >= 2 + expected) finish(null, all.subarray(2, 2 + expected));
      });
      const framed = Buffer.alloc(2 + message.length);
      framed.writeUInt16BE(message.length, 0);
      message.copy(framed, 2);
      socket.write(framed);
    });
  }
}
