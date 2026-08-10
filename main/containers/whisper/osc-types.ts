// =====================================================================
// osc-types.ts
//
// Minimal structural type for the OSC service dependency. The Whisper
// addon only needs `sendMessage(address, args)` to fire voice-command
// OSC, so we declare just that method here. This replaces the `any`
// type that was previously used in the addon's setOscService()
// signature.
//
// The concrete OscService class in main/services/oscService.ts already
// implements a compatible shape via duck typing; we don't need to
// import the full class (which would create a circular dep and pull
// in a lot of unrelated code).
// =====================================================================

export type OscArgType = 'f' | 'i' | 'bool' | 's'
export type OscArgValue = number | string | boolean

export interface OscMessageArg {
  type: OscArgType
  value: OscArgValue
}

export interface OscServiceLike {
  sendMessage(address: string, args: ReadonlyArray<OscMessageArg>): void
}