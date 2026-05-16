declare module 'ws' {
  import { EventEmitter } from 'node:events'

  type RawData = Buffer | ArrayBuffer | Buffer[]

  class WebSocket extends EventEmitter {
    static readonly CONNECTING: 0
    static readonly OPEN: 1
    static readonly CLOSING: 2
    static readonly CLOSED: 3
    constructor(address: string, protocols?: string | string[], options?: Record<string, unknown>)
    send(data: string | Buffer, callback?: (err?: Error) => void): void
    close(code?: number, reason?: string): void
    ping(data?: string | Buffer, mask?: boolean, callback?: (err: Error) => void): void
    pong(data?: string | Buffer, mask?: boolean, callback?: (err: Error) => void): void
    terminate(): void
    readonly readyState: number
  }

  namespace WebSocket {
    type RawData = Buffer | ArrayBuffer | Buffer[]
    const CONNECTING: 0
    const OPEN: 1
    const CLOSING: 2
    const CLOSED: 3
  }

  export = WebSocket
}
