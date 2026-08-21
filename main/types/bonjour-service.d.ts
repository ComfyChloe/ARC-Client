declare module 'bonjour-service' {
  export interface TxtData {
    [key: string]: string | number
  }

  export interface PublishOptions {
    /** Instance name - advertised as <name>.<type>.local */
    name: string
    /** Service type, e.g. _osc._tcp */
    type: string
    /** Port advertised in the SRV record */
    port: number
    /**
     * Single local IPv4 to advertise in the A record. Pinning exactly one
     * address prevents one A record per local interface (issue #34).
     */
    interface?: string
    /** Advertised IP alias - set alongside interface for release compatibility */
    address?: string
    /** TXT payload */
    txt?: TxtData
  }

  export interface Service {
    name: string
    type: string
    port: number
    stop(): void
  }

  export function publish(options: PublishOptions): Service

  const bonjour: {
    publish: typeof publish
  }
  export default bonjour
}
