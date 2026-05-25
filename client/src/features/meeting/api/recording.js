import { api } from '../../../api/client'

export function getRecordingState(code) {
  return api(`/api/meetings/${code}/recording`, { method: 'GET' })
}
export function startRecording(code) {
  return api(`/api/meetings/${code}/recording/start`, { method: 'POST' })
}
export function stopRecording(code) {
  return api(`/api/meetings/${code}/recording/stop`, { method: 'POST' })
}
