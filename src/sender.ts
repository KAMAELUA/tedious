import dgram from 'dgram';
import dns from 'dns';
import net from 'net';
import * as punycode from 'punycode';

type LookupFunction = (hostname: string, options: dns.LookupAllOptions, callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void) => void;

import AbortController from 'node-abort-controller';

class AbortError extends Error {
  code: string;

  constructor() {
    super('The operation was aborted');

    this.code = 'ABORT_ERR';
    this.name = 'AbortError';
  }
}

export class ParallelSendStrategy {
  addresses: dns.LookupAddress[];
  port: number;
  request: Buffer;

  socketV4: dgram.Socket | null;
  socketV6: dgram.Socket | null;

  onMessage: ((message: Buffer) => void) | null;
  onError: ((err: Error) => void) | null;
  signal: AbortSignal;

  constructor(addresses: dns.LookupAddress[], port: number, signal: AbortSignal, request: Buffer) {
    this.addresses = addresses;
    this.port = port;
    this.request = request;

    this.socketV4 = null;
    this.socketV6 = null;
    this.onError = null;
    this.onMessage = null;

    this.signal = signal;
  }

  clearSockets() {
    const clearSocket = (socket: dgram.Socket, onError: (err: Error) => void, onMessage: (message: Buffer) => void) => {
      socket.removeListener('error', onError);
      socket.removeListener('message', onMessage);
      socket.close();
    };

    if (this.socketV4) {
      clearSocket(this.socketV4, this.onError!, this.onMessage!);
      this.socketV4 = null;
    }

    if (this.socketV6) {
      clearSocket(this.socketV6, this.onError!, this.onMessage!);
      this.socketV6 = null;
    }
  }

  send(cb: (error: Error | null, message?: Buffer) => void) {
    if (this.signal.aborted) {
      return cb(new AbortError());
    }

    let errorCount = 0;

    const onError = (err: Error) => {
      errorCount++;

      if (errorCount === this.addresses.length) {
        this.signal.removeEventListener('abort', onAbort);
        this.clearSockets();

        cb(err);
      }
    };

    const onMessage = (message: Buffer) => {
      this.signal.removeEventListener('abort', onAbort);
      this.clearSockets();

      cb(null, message);
    };

    const onAbort = () => {
      this.clearSockets();

      cb(new AbortError());
    };

    this.signal.addEventListener('abort', onAbort, { once: true });

    const createDgramSocket = (udpType: 'udp4' | 'udp6', onError: (err: Error) => void, onMessage: (message: Buffer) => void) => {
      const socket = dgram.createSocket(udpType);

      socket.on('error', onError);
      socket.on('message', onMessage);
      return socket;
    };

    for (let j = 0; j < this.addresses.length; j++) {
      const udpTypeV4 = 'udp4';
      const udpTypeV6 = 'udp6';

      const udpType = this.addresses[j].family === 6 ? udpTypeV6 : udpTypeV4;
      let socket;

      if (udpType === udpTypeV4) {
        if (!this.socketV4) {
          this.socketV4 = createDgramSocket(udpTypeV4, onError, onMessage);
        }

        socket = this.socketV4;
      } else {
        if (!this.socketV6) {
          this.socketV6 = createDgramSocket(udpTypeV6, onError, onMessage);
        }

        socket = this.socketV6;
      }

      socket.send(this.request, 0, this.request.length, this.port, this.addresses[j].address);
    }

    this.onError = onError;
    this.onMessage = onMessage;
  }
}

export class Sender {
  host: string;
  port: number;
  request: Buffer;
  lookup: LookupFunction;
  controller: AbortController;

  constructor(host: string, port: number, lookup: LookupFunction, request: Buffer) {
    this.host = host;
    this.port = port;
    this.request = request;
    this.lookup = lookup;

    this.controller = new AbortController();
  }

  execute(cb: (error: Error | null, message?: Buffer) => void) {
    if (net.isIP(this.host)) {
      this.executeForIP(cb);
    } else {
      this.executeForHostname(cb);
    }
  }

  executeForIP(cb: (error: Error | null, message?: Buffer) => void) {
    this.executeForAddresses([{ address: this.host, family: net.isIPv6(this.host) ? 6 : 4 }], cb);
  }

  // Wrapper for stubbing. Sinon does not have support for stubbing module functions.
  invokeLookupAll(host: string, cb: (error: Error | null, addresses?: dns.LookupAddress[]) => void) {
    this.lookup.call(null, punycode.toASCII(host), { all: true }, cb);
  }

  executeForHostname(cb: (error: Error | null, message?: Buffer) => void) {
    this.invokeLookupAll(this.host, (err, addresses) => {
      if (err) {
        return cb(err);
      }

      this.executeForAddresses(addresses!, cb);
    });
  }

  executeForAddresses(addresses: dns.LookupAddress[], cb: (error: Error | null, message?: Buffer) => void) {
    const parallelSendStrategy = new ParallelSendStrategy(addresses, this.port, this.controller.signal, this.request);
    parallelSendStrategy.send(cb);
  }

  cancel() {
    this.controller.abort();
  }
}
