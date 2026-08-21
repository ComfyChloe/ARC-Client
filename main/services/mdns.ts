/**
 * mDNS (Bonjour) service advertising for the OSC client.
 *
 * Fixes issue #34 (OSC and OSCQuery mDNS issues):
 *
 *  1. Multiple IPs advertised on Linux - bonjour-service emits one A record
 *     per local interface when no address is pinned, so multi-interface
 *     hosts (e.g. eth0 + bridge6) showed two IPs for one service.
 *  2. Service visible but no address on Windows - same root cause: the
 *     auto-detected address list is unreliable there, so the A record was
 *     missing or empty.
 *  3. Missing osc.local service - only _oscjson._tcp (oscquery) was being
 *     advertised. VRChat/ARC-OSC tooling needs the plain OSC service; the
 *     "osc" instance under _osc._tcp also advertises the hostname
 *     osc.local -> IP, telling clients where to send OSC data.
 *
 * All of the above are solved by resolving one best local IPv4 address and
 * pinning it on both published services (and stopping duplicates).
 */
import { networkInterfaces } from 'node:os'
import { isIP } from 'node:net'
import debug from './debugger'
import bonjour from 'bonjour-service'

type PublishedService = ReturnType<typeof bonjour.publish>

interface MdnsState {
  services: PublishedService[]
  port: number
  address: string
  name: string
}

let state: MdnsState | null = null

/**
 * Resolve the single local IPv4 address to advertise.
 *
 * Preference order: first non-internal, non-link-local IPv4, then any
 * link-local IPv4, then loopback. We always return exactly one address so
 * exactly one A record is advertised, on every platform.
 */
function selectLocalIPv4Address(): string {
  let linkLocal: string | null = null
  for (const addrs of Object.values(networkInterfaces())) {
    if (!addrs) continue
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      if (!isIP(addr.address)) continue
      if (addr.address.startsWith('169.254.')) {
        if (!linkLocal) linkLocal = addr.address
        continue
      }
      return addr.address
    }
  }
  return linkLocal ?? '127.0.0.1'
}

/**
 * Start advertising the mDNS services the client provides.
 *
 * @param port UDP port the OSC socket is listening on
 * @param name Instance name for the OSC-JSON (oscquery) service, e.g. "ARC-OSC-Client-XH5G4"
 * @param txt  Optional extra TXT payload merged into both services
 */
export function start(
  port: number,
  name: string,
  txt: Record<string, string | number> = {}
): { success: boolean; error?: string; address?: string } {
  // Idempotent: never advertise the same service twice (a duplicate
  // publish is what produces the doubled entries seen in avahi output).
  stop()

  let address: string
  try {
    address = selectLocalIPv4Address()
  } catch (error) {
    const msg = (error as Error).message
    debug.error(`[mDNS] Failed to resolve local address: ${msg}`)
    return { success: false, error: msg }
  }

  const services: PublishedService[] = []
  // Pin exactly one advertised IP. bonjour-service releases name this
  // option differently (interface vs address); setting both keys
  // guarantees a single A record either way - and never one per interface.
  const pinned = { interface: address, address }

  try {
    // 1) OSC-JSON transport - the service ARC-OSC oscquery clients browse for
    services.push(
      bonjour.publish({
        name,
        type: '_oscjson._tcp',
        port,
        ...pinned,
        txt: { ...txt }
      })
    )

    // 2) Plain OSC service - previously missing entirely. The "osc"
    //    instance name also advertises the osc.local hostname (-> address),
    //    which is what tells VRChat where to send OSC data.
    services.push(
      bonjour.publish({
        name: 'osc',
        type: '_osc._tcp',
        port,
        ...pinned,
        txt: { ...txt }
      })
    )
  } catch (error) {
    for (const service of services) {
      try {
        service.stop()
      } catch {
        // Best effort - the socket is already gone
      }
    }
    const msg = (error as Error).message
    debug.error(`[mDNS] Failed to publish services: ${msg}`)
    return { success: false, error: msg }
  }

  state = { services, port, address, name }
  debug.info(`[mDNS] Advertising ${name} (_oscjson._tcp) and osc (_osc._tcp) on port ${port}, address ${address}`)
  return { success: true, address }
}

/** Stop advertising all mDNS services. */
export function stop(): void {
  if (!state) return
  for (const service of state.services) {
    try {
      service.stop()
    } catch (error) {
      debug.warn(`[mDNS] Error stopping service: ${(error as Error).message}`)
    }
  }
  state = null
  debug.info('[mDNS] Stopped advertising all services')
}

/** Current advertising state (for the status UI). */
export function getStatus(): { running: boolean; port: number | null; address: string | null; name: string | null } {
  if (!state) {
    return { running: false, port: null, address: null, name: null }
  }
  return { running: true, port: state.port, address: state.address, name: state.name }
}
