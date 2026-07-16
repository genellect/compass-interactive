export type RealtimeCaptionEvent =
  | { delta: string; itemId: string; type: 'delta' }
  | { itemId: string; transcript: string; type: 'completed' }

type RealtimeCaptionSessionOptions = {
  mediaStream: MediaStream
  onEvent: (event: RealtimeCaptionEvent) => void
  onFailure: (message: string) => void
}

function parseRealtimeEvent(value: string): RealtimeCaptionEvent | null {
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(value) as Record<string, unknown>
  } catch {
    return null
  }
  const itemId = typeof payload.item_id === 'string' ? payload.item_id : ''
  if (!itemId) return null
  if (
    payload.type === 'conversation.item.input_audio_transcription.delta' &&
    typeof payload.delta === 'string'
  ) {
    return { delta: payload.delta, itemId, type: 'delta' }
  }
  if (
    payload.type === 'conversation.item.input_audio_transcription.completed' &&
    typeof payload.transcript === 'string'
  ) {
    return { itemId, transcript: payload.transcript, type: 'completed' }
  }
  return null
}

export class RealtimeCaptionSession {
  private commitTimer: number | null = null
  private dataChannel: RTCDataChannel | null = null
  private peerConnection: RTCPeerConnection | null = null
  private stopped = false
  private readonly options: RealtimeCaptionSessionOptions

  constructor(options: RealtimeCaptionSessionOptions) {
    this.options = options
  }

  async createOffer() {
    if (this.peerConnection) {
      throw new Error('Realtime transcription connection is already prepared.')
    }
    const peerConnection = new RTCPeerConnection()
    this.peerConnection = peerConnection
    for (const track of this.options.mediaStream.getAudioTracks()) {
      peerConnection.addTrack(track, this.options.mediaStream)
    }

    const dataChannel = peerConnection.createDataChannel('oai-events')
    this.dataChannel = dataChannel
    dataChannel.addEventListener('message', (message) => {
      if (typeof message.data !== 'string') return
      const event = parseRealtimeEvent(message.data)
      if (event) this.options.onEvent(event)
      try {
        const payload = JSON.parse(message.data) as {
          error?: { message?: string }
          type?: string
        }
        if (payload.type === 'error') {
          this.fail(payload.error?.message ?? 'Realtime transcription failed.')
        }
      } catch {
        // Non-JSON data is ignored; no transcript content is persisted here.
      }
    })
    peerConnection.addEventListener('connectionstatechange', () => {
      if (
        !this.stopped &&
        ['failed', 'disconnected', 'closed'].includes(
          peerConnection.connectionState,
        )
      ) {
        this.fail('Realtime transcription connection ended.')
      }
    })

    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)
    if (!offer.sdp || !offer.sdp.startsWith('v=0')) {
      this.stop()
      throw new Error('Realtime WebRTC offer could not be prepared.')
    }
    return offer.sdp
  }

  async connect(answerSdp: string) {
    const peerConnection = this.peerConnection
    const dataChannel = this.dataChannel
    if (!peerConnection || !dataChannel || this.stopped) {
      throw new Error('Realtime transcription connection is not prepared.')
    }
    if (!answerSdp.startsWith('v=0')) {
      this.stop()
      throw new Error('Realtime WebRTC answer is invalid.')
    }
    await peerConnection.setRemoteDescription({
      sdp: answerSdp,
      type: 'answer',
    })
    this.commitTimer = window.setInterval(() => {
      if (dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
      }
    }, 4_000)
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    if (this.commitTimer !== null) window.clearInterval(this.commitTimer)
    this.commitTimer = null
    this.dataChannel?.close()
    this.peerConnection?.close()
    for (const track of this.options.mediaStream.getTracks()) track.stop()
  }

  private fail(message: string) {
    this.stop()
    this.options.onFailure(message)
  }
}

export { parseRealtimeEvent }
