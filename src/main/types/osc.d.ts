declare module 'osc' {
  class UDPPort {
    constructor(options: any)
    open(): void
    close(): void
    send(msg: any): void
    on(event: string, callback: (...args: any[]) => void): void
  }
  export { UDPPort }
  export default { UDPPort }
}
